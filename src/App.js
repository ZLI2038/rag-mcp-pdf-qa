import React, { useCallback, useState } from "react";
import axios from "axios";
import { API_URL, sessionHeaders } from "./api";
import PdfUploader from "./components/PdfUploader";
import ChatComponent from "./components/ChatComponent";
import RenderQA from "./components/RenderQA";
import { Button, Layout, message, Typography } from "antd";

const chatComponentStyle = {
  position: "fixed",
  bottom: "0",
  width: "80%",
  left: "10%", // this will center it because it leaves 10% space on each side
  marginBottom: "20px",
};

const pdfUploaderStyle = {
  margin: "auto",
  paddingTop: "80px",
};

const renderQAStyle = {
  height: "50%", // adjust the height as you see fit
  overflowY: "auto",
};

const App = () => {
  const [conversation, setConversation] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [document, setDocument] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const { Header, Content } = Layout;
  const { Title } = Typography;

  const handleResp = useCallback((question, answer) => {
    setConversation((prev) => [...prev, { question, answer }]);
  }, []);

  const handleUpload = useCallback((uploaded) => {
    if (document) {
      axios.delete(`${API_URL}/documents/${document.documentId}`, { headers: sessionHeaders() }).catch(() => {});
    }
    setDocument(uploaded);
    setConversation([]);
    setIsLoading(false);
  }, [document]);

  const removeDocument = async () => {
    if (!document) return;
    setIsUploading(true);
    try {
      await axios.delete(`${API_URL}/documents/${document.documentId}`, { headers: sessionHeaders() });
      setDocument(null);
      setConversation([]);
    } catch (error) {
      // An expired document is already removed on the server.
      if (error.response?.status === 404) {
        setDocument(null);
        setConversation([]);
      } else message.error("Could not remove the document. Please try again.");
    } finally { setIsUploading(false); }
  };

  return (
    <>
      <Layout style={{ height: "100vh", backgroundColor: "white" }}>
        <Header
          style={{
            display: "flex",
            alignItems: "center",
          }}
        >
          <Title level={1} style={{ color: "white", margin: 0 }}>
            Agent AI
          </Title>
        </Header>
        <Content style={{ width: "80%", margin: "auto" }}>
          <div style={pdfUploaderStyle}>
            <PdfUploader onUploaded={handleUpload} onUploadingChange={setIsUploading} disabled={isLoading} />
            {document && <p>Active document: {document.name} <Button onClick={removeDocument} disabled={isLoading || isUploading}>Remove PDF</Button></p>}
          </div>

          <br />
          <br />
          <div style={renderQAStyle}>
            <RenderQA conversation={conversation} isLoading={isLoading} />
          </div>

          <br />
          <br />
        </Content>
        <div style={chatComponentStyle}>
          <ChatComponent
            key={document?.documentId || "no-document"}
            documentId={document?.documentId}
            disabled={isUploading}
            handleResp={handleResp}
            isLoading={isLoading}
            setIsLoading={setIsLoading}
          />
        </div>
      </Layout>
    </>
  );
};

export default App;
