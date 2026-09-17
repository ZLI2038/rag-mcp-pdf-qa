import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axios from 'axios';
import SpeechRecognition from 'react-speech-recognition';
import App from '../App';
import ChatComponent from './ChatComponent';
import PdfUploader from './PdfUploader';
import RenderQA from './RenderQA';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), delete: jest.fn().mockResolvedValue({}) }));
let mockRecognition;
const mockSpeak = jest.fn();
const mockInit = jest.fn();
jest.mock('react-speech-recognition', () => ({
  __esModule: true,
  default: { startListening: jest.fn(), stopListening: jest.fn() },
  useSpeechRecognition: () => mockRecognition,
}));
jest.mock('speak-tts', () => class SpeechMock {
  init(options) { return mockInit(options); }
  speak(options) { return mockSpeak(options); }
});

let props;
beforeEach(() => {
  jest.clearAllMocks();
  mockRecognition = {
    transcript: '', listening: false, resetTranscript: jest.fn(),
    browserSupportsSpeechRecognition: true, isMicrophoneAvailable: true,
  };
  props = { handleResp: jest.fn(), setIsLoading: jest.fn(), isLoading: false, documentId: 'document-one' };
  mockInit.mockResolvedValue({});
  mockSpeak.mockResolvedValue();
  axios.get.mockResolvedValue({ data: { ragAnswer: 'Document answer', mcpAnswer: 'Web answer' } });
  axios.post.mockResolvedValue({ status: 201, data: { documentId: 'document-one', name: 'fixture.pdf' } });
});

async function renderChat() {
  const view = render(<ChatComponent {...props} />);
  await waitFor(() => expect(mockInit).toHaveBeenCalled());
  await act(async () => {});
  return view;
}

test('submits a trimmed typed question, returns two answers, and clears loading', async () => {
  await renderChat();
  const input = screen.getByRole('searchbox', { name: 'Ask a question about the uploaded PDF' });
  fireEvent.change(input, { target: { value: '  What is a startup?  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await waitFor(() => expect(props.handleResp).toHaveBeenCalledWith('What is a startup?', {
    ragAnswer: 'Document answer', mcpAnswer: 'Web answer',
  }));
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/chat'), expect.objectContaining({ params: { question: 'What is a startup?', documentId: 'document-one' }, headers: expect.objectContaining({ 'X-Session-Id': expect.any(String) }) }));
  expect(input).toHaveValue('');
  expect(props.setIsLoading.mock.calls).toEqual([[true], [false]]);
  expect(mockSpeak).not.toHaveBeenCalled();
});

test('submits typed questions with Enter', async () => {
  await renderChat();
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: 'What is an MVP?' } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13, keyCode: 13 });
  await waitFor(() => expect(axios.get).toHaveBeenCalledTimes(1));
});

test('does not submit whitespace-only questions', async () => {
  await renderChat();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(axios.get).not.toHaveBeenCalled();
  expect(props.setIsLoading).not.toHaveBeenCalled();
});

test('displays the backend error and exits the loading state', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  axios.get.mockRejectedValueOnce({ response: { data: { error: 'Please upload a PDF first.' } } });
  await renderChat();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await waitFor(() => expect(props.handleResp).toHaveBeenCalledWith('Question', { ragAnswer: 'Please upload a PDF first.', mcpAnswer: 'N/A' }));
  expect(props.setIsLoading).toHaveBeenLastCalledWith(false);
  errorLog.mockRestore();
});

test('reports a network failure without leaving loading active', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  axios.get.mockRejectedValueOnce(new Error('Network offline'));
  await renderChat();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await waitFor(() => expect(props.handleResp).toHaveBeenCalledWith('Question', { ragAnswer: 'Network offline', mcpAnswer: 'N/A' }));
  expect(props.setIsLoading).toHaveBeenLastCalledWith(false);
  errorLog.mockRestore();
});

test('switches between text and voice input and resets recognition', async () => {
  await renderChat();
  const toggle = screen.getByRole('button', { name: 'Toggle voice chat mode' });
  fireEvent.click(toggle);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
  expect(SpeechRecognition.stopListening).toHaveBeenCalledTimes(2);
  expect(mockRecognition.resetTranscript).toHaveBeenCalledTimes(2);
});

test.each([
  ['unsupported browser', 'browserSupportsSpeechRecognition'],
  ['unavailable microphone', 'isMicrophoneAvailable'],
])('keeps text input available for an %s', async (_, field) => {
  mockRecognition[field] = false;
  await renderChat();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start recording' })).not.toBeInTheDocument();
  expect(SpeechRecognition.startListening).not.toHaveBeenCalled();
});

test('starts and stops recording using accessible controls', async () => {
  await renderChat();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  expect(SpeechRecognition.startListening).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
  expect(SpeechRecognition.stopListening).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
});

test('submits only after recognition stops, speaks the document answer, then listens again', async () => {
  const view = await renderChat();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  mockRecognition = { ...mockRecognition, transcript: 'Explain customer discovery', listening: true };
  view.rerender(<ChatComponent {...props} />);
  expect(axios.get).not.toHaveBeenCalled();
  mockRecognition = { ...mockRecognition, listening: false };
  view.rerender(<ChatComponent {...props} />);
  await waitFor(() => expect(props.handleResp).toHaveBeenCalledTimes(1));
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(mockSpeak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Document answer', queue: false }));
  await waitFor(() => expect(SpeechRecognition.startListening).toHaveBeenCalledTimes(1));
});

test('falls back to a default voice when the preferred voice is unavailable', async () => {
  mockInit.mockRejectedValueOnce(new Error('Preferred voice missing')).mockResolvedValueOnce({});
  await renderChat();
  await waitFor(() => expect(mockInit).toHaveBeenCalledTimes(2));
  expect(mockInit.mock.calls[0][0].voice).toBe('Google US English');
  expect(mockInit.mock.calls[1][0].voice).toBeUndefined();
});

test('retains text input when both speech initializations fail', async () => {
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  mockInit.mockRejectedValueOnce(new Error('Voice unavailable')).mockRejectedValueOnce(new Error('Speech unavailable'));
  await renderChat();
  await waitFor(() => expect(errorLog).toHaveBeenCalled());
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
  errorLog.mockRestore();
});

test('uploads a selected PDF as multipart file data', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const { container } = render(<PdfUploader />);
  const file = new File(['%PDF-fixture'], 'fixture.pdf', { type: 'application/pdf' });
  fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [file] } });
  await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
  expect(axios.post.mock.calls[0][1].get('file')).toBe(file);
  await waitFor(() => expect(screen.getByText('fixture.pdf file uploaded successfully.')).toBeInTheDocument());
  log.mockRestore();
});

test('reports a failed upload to the user', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  axios.post.mockRejectedValueOnce(new Error('Upload failed'));
  const { container } = render(<PdfUploader />);
  fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['%PDF'], 'failed.pdf', { type: 'application/pdf' })] } });
  await waitFor(() => expect(screen.getByText('Upload failed')).toBeInTheDocument());
  log.mockRestore();
  errorLog.mockRestore();
});

test('preserves a multi-turn conversation and labels both answer sources', () => {
  render(<RenderQA conversation={[
    { question: 'First question', answer: { ragAnswer: 'Document one', mcpAnswer: 'Web one' } },
    { question: 'Second question', answer: { ragAnswer: 'Document two', mcpAnswer: 'Web two' } },
  ]} isLoading={false} />);
  for (const text of ['First question', 'Second question', 'Document one', 'Document two', 'Web one', 'Web two']) {
    expect(screen.getByText(text)).toBeInTheDocument();
  }
  expect(screen.getAllByText('RAG Answer (from document):')).toHaveLength(2);
  expect(screen.getAllByText('MCP Answer (with web search):')).toHaveLength(2);
});

test('renders fallbacks for missing answers and shows the loading indicator', () => {
  const { container } = render(<RenderQA conversation={[{ question: 'Question', answer: {} }]} isLoading />);
  expect(screen.getByText('No document answer available.')).toBeInTheDocument();
  expect(screen.getByText('No web-search answer available.')).toBeInTheDocument();
  expect(container.querySelector('.ant-spin')).toBeInTheDocument();
});

test('integrates a typed question with both answers in the full App', async () => {
  const { container } = render(<App />);
  fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['%PDF'], 'fixture.pdf', { type: 'application/pdf' })] } });
  await waitFor(() => expect(screen.getByText('Active document: fixture.pdf')).toBeInTheDocument());
  await act(async () => {});
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Explain lean startup' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await waitFor(() => expect(screen.getByText('Document answer')).toBeInTheDocument());
  expect(screen.getByText('Web answer')).toBeInTheDocument();
  expect(screen.getByText('Explain lean startup')).toBeInTheDocument();
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test('blocks questions until a document has been selected', async () => {
  props.documentId = undefined;
  await renderChat();
  expect(screen.getByRole('searchbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Toggle voice chat mode' })).toBeDisabled();
  expect(axios.get).not.toHaveBeenCalled();
});

test('rapid duplicate submissions share one pending request', async () => {
  let finish;
  axios.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await renderChat();
  const input = screen.getByRole('searchbox');
  fireEvent.change(input, { target: { value: 'Question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  fireEvent.change(input, { target: { value: 'Question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  expect(axios.get).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ data: { ragAnswer: 'Answer', mcpAnswer: 'Web' } }); });
});

test('an empty recognition cycle returns to idle without submitting', async () => {
  const view = await renderChat();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle voice chat mode' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  mockRecognition = { ...mockRecognition, listening: true, transcript: '' };
  view.rerender(<ChatComponent {...props} />);
  mockRecognition = { ...mockRecognition, listening: false };
  view.rerender(<ChatComponent {...props} />);
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();
  expect(axios.get).not.toHaveBeenCalled();
});

test('removing the active PDF clears the conversation and disables questions', async () => {
  const { container } = render(<App />);
  fireEvent.change(container.querySelector('input[type=file]'), { target: { files: [new File(['%PDF'], 'fixture.pdf', { type: 'application/pdf' })] } });
  await waitFor(() => expect(screen.getByText('Active document: fixture.pdf')).toBeInTheDocument());
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
  await waitFor(() => expect(screen.getByText('Document answer')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Remove PDF' }));
  await waitFor(() => expect(screen.queryByText('Active document: fixture.pdf')).not.toBeInTheDocument());
  expect(screen.queryByText('Document answer')).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toBeDisabled();
  expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/documents/document-one'), expect.objectContaining({ headers: expect.any(Object) }));
});
