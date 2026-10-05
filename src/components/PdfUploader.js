import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { InboxOutlined } from "@ant-design/icons";
import { message, Upload } from "antd";
import { API_URL, sessionHeaders } from "../api";

const { Dragger } = Upload;
const PdfUploader = ({ onUploaded, onUploadingChange, disabled = false }) => {
  const [uploading, setUploading] = useState(false);
  const request = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  const customRequest = async ({ file, onSuccess, onError }) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setUploading(true);
    onUploadingChange?.(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await axios.post(API_URL + "/upload", form, { headers: sessionHeaders(), signal: controller.signal });
      if (!response.data?.documentId) throw new Error("The server did not return a document ID.");
      if (controller.signal.aborted) return;
      onUploaded?.(response.data);
      onSuccess(response.data);
    } catch (error) {
      if (!controller.signal.aborted) onError(new Error(error.response?.data?.error || error.message || "Upload failed."));
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        request.current = null;
        setUploading(false);
        onUploadingChange?.(false);
      }
    }
  };

  return (
    <Dragger aria-label="Upload PDF documents" name="file" multiple={false} maxCount={1}
      accept=".pdf,application/pdf" disabled={disabled || uploading} customRequest={customRequest}
      showUploadList={{ showRemoveIcon: false }}
      beforeUpload={file => {
        if (!/\.pdf$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
          message.error("Choose a PDF no larger than 10 MB.");
          return Upload.LIST_IGNORE;
        }
        return true;
      }}
      onChange={({ file }) => {
        if (file.status === "done") message.success(file.name + " file uploaded successfully.");
        if (file.status === "error") message.error(file.error?.message || file.name + " file upload failed.");
      }}>
      <p className="ant-upload-drag-icon"><InboxOutlined /></p>
      <p className="ant-upload-text">Click or drag file to this area to upload</p>
      <p className="ant-upload-hint">Upload one text-based PDF at a time (up to 10 MB and 200 pages).</p>
    </Dragger>
  );
};
export default PdfUploader;
