import { render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("react-speech-recognition", () => ({
  __esModule: true,
  default: {
    startListening: jest.fn(),
    stopListening: jest.fn(),
  },
  useSpeechRecognition: () => ({
    transcript: "",
    listening: false,
    resetTranscript: jest.fn(),
    browserSupportsSpeechRecognition: true,
    isMicrophoneAvailable: true,
  }),
}));

jest.mock("speak-tts", () =>
  class SpeechMock {
    init() {
      return new Promise(() => {});
    }

    speak() {
      return Promise.resolve();
    }
  }
);

test("renders the Agent AI PDF chat interface", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Agent AI" })).toBeInTheDocument();
  expect(
    screen.getByText("Click or drag file to this area to upload")
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
  expect(screen.getByText("Chat Mode: Off")).toBeInTheDocument();
});
