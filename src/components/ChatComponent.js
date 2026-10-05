import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Button, Input, message } from "antd";
import { AudioOutlined } from "@ant-design/icons";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import Speech from "speak-tts";
import { API_URL, sessionHeaders } from "../api";

const { Search } = Input;

const ChatComponent = ({ handleResp, isLoading, setIsLoading, documentId, disabled = false }) => {
  const [searchValue, setSearchValue] = useState("");
  const [isChatModeOn, setIsChatModeOn] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const mounted = useRef(false);
  const mode = useRef(false);
  const generation = useRef(0);
  const pendingUtterance = useRef(false);
  const request = useRef(null);
  const speech = useRef(null);
  const { transcript, listening, resetTranscript, browserSupportsSpeechRecognition, isMicrophoneAvailable } = useSpeechRecognition();

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const options = { volume: 1, lang: "en-US", rate: 1, pitch: 1, splitSentences: false };
    const preferred = new Speech();
    preferred.init({ ...options, voice: "Google US English" })
      .then(() => preferred)
      .catch(() => {
        if (!active) return null;
        const fallback = new Speech();
        return fallback.init(options).then(() => fallback);
      })
      .then(instance => { if (active) speech.current = instance; })
      .catch(() => { if (active) console.error("Speech initialization failed."); });
    return () => {
      active = false;
      mounted.current = false;
      generation.current += 1;
      request.current?.abort();
      speech.current?.cancel?.();
      SpeechRecognition.stopListening();
    };
  }, []);

  const stopVoice = useCallback(() => {
    generation.current += 1;
    mode.current = false;
    pendingUtterance.current = false;
    setIsChatModeOn(false);
    setIsRecording(false);
    setIsSpeaking(false);
    SpeechRecognition.stopListening();
    speech.current?.cancel?.();
    resetTranscript();
  }, [resetTranscript]);

  useEffect(() => {
    if (disabled || !documentId) stopVoice();
  }, [disabled, documentId, stopVoice]);

  const startListening = useCallback(() => {
    if (!mounted.current || !mode.current || request.current || disabled || !documentId ||
        !browserSupportsSpeechRecognition || !isMicrophoneAvailable) return;
    pendingUtterance.current = false;
    resetTranscript();
    setIsRecording(true);
    const turn = generation.current;
    Promise.resolve(SpeechRecognition.startListening()).catch(() => {
      if (mounted.current && turn === generation.current) {
        setIsRecording(false);
        message.warning("Microphone access could not be started.");
      }
    });
  }, [browserSupportsSpeechRecognition, isMicrophoneAvailable, resetTranscript, disabled, documentId]);

  const talk = useCallback(async (text, turn) => {
    if (!speech.current || !text || !mode.current || turn !== generation.current) return;
    setIsSpeaking(true);
    try {
      await speech.current.speak({ text, queue: false });
      if (mounted.current && mode.current && turn === generation.current) {
        setIsSpeaking(false);
        startListening();
      }
    } catch {
      if (mounted.current && turn === generation.current) setIsSpeaking(false);
    }
  }, [startListening]);

  const onSearch = useCallback(async question => {
    const normalized = question?.trim();
    if (!normalized || !documentId || disabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const turn = generation.current;
    setSearchValue("");
    setIsLoading(true);
    try {
      const response = await axios.get(API_URL + "/chat", {
        params: { question: normalized, documentId }, headers: sessionHeaders(), signal: controller.signal,
      });
      if (!mounted.current || controller.signal.aborted) return;
      handleResp(normalized, response.data);
      if (mode.current && turn === generation.current) void talk(response.data?.ragAnswer, turn);
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) handleResp(normalized, {
        ragAnswer: error.response?.data?.error || error.message || "Request failed.", mcpAnswer: "N/A",
      });
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current) setIsLoading(false);
    }
  }, [documentId, disabled, handleResp, setIsLoading, talk]);

  useEffect(() => {
    if (!mode.current || disabled || !documentId) return;
    if (listening) {
      pendingUtterance.current = true;
      return;
    }
    // Consume each recognition cycle before changing React state. A rerender
    // or a new callback cannot submit the same completed cycle a second time.
    if (pendingUtterance.current) {
      pendingUtterance.current = false;
      const question = transcript;
      resetTranscript();
      setIsRecording(false);
      if (question.trim()) void onSearch(question);
    }
  }, [listening, transcript, onSearch, resetTranscript, disabled, documentId]);

  const toggleVoice = () => {
    if (mode.current) return stopVoice();
    if (!browserSupportsSpeechRecognition || !isMicrophoneAvailable) {
      message.warning("Speech recognition is unavailable in this browser or microphone access is disabled.");
      return;
    }
    generation.current += 1;
    mode.current = true;
    pendingUtterance.current = false;
    setIsChatModeOn(true);
    setIsRecording(false);
    SpeechRecognition.stopListening();
    resetTranscript();
  };

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      {!isChatModeOn && <Search aria-label="Ask a question about the uploaded PDF"
        placeholder={documentId ? "Ask about your PDF" : "Upload a PDF to ask a question"}
        enterButton="Ask" size="large" onSearch={onSearch} loading={isLoading}
        disabled={disabled || !documentId} value={searchValue} onChange={event => setSearchValue(event.target.value)} />}
      <Button aria-label="Toggle voice chat mode" type="primary" size="large" danger={isChatModeOn}
        disabled={disabled || !documentId} onClick={toggleVoice} style={{ marginLeft: "5px" }}>
        Chat Mode: {isChatModeOn ? "On" : "Off"}
      </Button>
      {isChatModeOn && <Button aria-label={isRecording ? "Stop recording" : "Start recording"}
        type="primary" icon={<AudioOutlined />} size="large" danger={isRecording} disabled={isLoading || isSpeaking}
        onClick={() => {
          if (isRecording) {
            pendingUtterance.current = false;
            generation.current += 1;
            setIsRecording(false);
            SpeechRecognition.stopListening();
            resetTranscript();
          } else startListening();
        }} style={{ marginLeft: "5px" }}>
        {isSpeaking ? "Speaking..." : isRecording ? "Recording..." : "Click to record"}
      </Button>}
    </div>
  );
};
export default ChatComponent;
