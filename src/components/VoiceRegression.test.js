import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import SpeechRecognition from 'react-speech-recognition';
import App from '../App';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), delete: jest.fn() }));
let mockState;
const mockSpeak = jest.fn();
const mockCancel = jest.fn();
jest.mock('react-speech-recognition', () => ({
  __esModule: true,
  default: { startListening: jest.fn(), stopListening: jest.fn() },
  useSpeechRecognition: () => mockState,
}));
jest.mock('speak-tts', () => class SpeechMock {
  init() { return Promise.resolve({}); }
  speak(options) { return mockSpeak(options); }
  cancel() { mockCancel(); }
});

beforeEach(() => {
  jest.clearAllMocks();
  mockState = { transcript: '', listening: false, resetTranscript: jest.fn(), browserSupportsSpeechRecognition: true, isMicrophoneAvailable: true };
  axios.post.mockResolvedValue({ status: 201, data: { documentId: 'test-document', name: 'sample.pdf' } });
  axios.delete.mockResolvedValue({});
  mockSpeak.mockImplementation(() => new Promise(() => {}));
});

async function startVoice() {
  const view = render(<App />);
  fireEvent.change(view.container.querySelector('input[type=file]'), {
    target: { files: [new File(['%PDF'], 'sample.pdf', { type: 'application/pdf' })] },
  });
  await waitFor(() => expect(screen.getByText('Active document: sample.pdf')).toBeInTheDocument());
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  return view;
}
function completeUtterance(view, text = 'One spoken question') {
  mockState = { ...mockState, listening: true, transcript: text };
  view.rerender(<App />);
  mockState = { ...mockState, listening: false };
  view.rerender(<App />);
}
function deferredResponse() {
  let resolve;
  axios.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  return async () => act(async () => { resolve({ data: { ragAnswer: 'Document answer', mcpAnswer: 'Web answer' } }); });
}

test('one completed utterance sends exactly one request across loading, answer and parent rerenders', async () => {
  const finish = deferredResponse();
  const view = await startVoice();
  completeUtterance(view);
  expect(axios.get).toHaveBeenCalledTimes(1);
  await finish();
  view.rerender(<App />);
  await act(async () => {});
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(mockSpeak).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('Document answer')).toHaveLength(1);
});

test('the same words spoken in a later recognition cycle can be submitted again', async () => {
  axios.get.mockResolvedValue({ data: { ragAnswer: 'Answer', mcpAnswer: 'Web' } });
  mockSpeak.mockResolvedValue();
  const view = await startVoice();
  completeUtterance(view);
  await waitFor(() => expect(mockSpeak).toHaveBeenCalledTimes(1));
  await act(async () => {});
  completeUtterance(view);
  await waitFor(() => expect(mockSpeak).toHaveBeenCalledTimes(2));
  expect(axios.get).toHaveBeenCalledTimes(2);
});

test('turning voice off while an answer is pending prevents speech and automatic microphone restart', async () => {
  const finish = deferredResponse();
  const view = await startVoice();
  completeUtterance(view);
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  await finish();
  expect(mockSpeak).not.toHaveBeenCalled();
  expect(SpeechRecognition.startListening).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
});

test('finishing old speech after voice mode is turned off does not restart recording', async () => {
  let finishSpeech;
  mockSpeak.mockImplementation(() => new Promise(resolve => { finishSpeech = resolve; }));
  axios.get.mockResolvedValue({ data: { ragAnswer: 'Answer', mcpAnswer: 'Web' } });
  const view = await startVoice();
  completeUtterance(view);
  await waitFor(() => expect(mockSpeak).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  await act(async () => { finishSpeech(); });
  expect(SpeechRecognition.startListening).toHaveBeenCalledTimes(1);
  expect(mockCancel).toHaveBeenCalled();
});

test('unmounting aborts the pending request and ignores a late response', async () => {
  const finish = deferredResponse();
  const view = await startVoice();
  completeUtterance(view);
  const signal = axios.get.mock.calls[0][1].signal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await finish();
  expect(mockSpeak).not.toHaveBeenCalled();
});

test('a transcript outside voice mode never triggers a request', async () => {
  const view = await startVoice();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  completeUtterance(view, 'Stale text');
  expect(axios.get).not.toHaveBeenCalled();
});
