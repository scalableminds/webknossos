import { sendHelpEmail } from "admin/rest_api";
import { Button, Input, Modal, Segmented, Space, message } from "antd";
import type React from "react";
import { CSSProperties, useState } from "react";
import { HelpChat } from "./help_chat";

type HelpMode = "ai" | "email";

type HelpModalProps = {
  isModalOpen: boolean;
  centeredLayout: boolean;
  onCancel: () => void;
};

export function HelpModal(props: HelpModalProps) {
  const [helpText, setHelpText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [mode, setMode] = useState<HelpMode>("ai");
  const positionStyle: CSSProperties = { right: 10, bottom: 40, top: "auto", position: "fixed" };

  const sendHelp = async () => {
    if (helpText.length > 0) {
      try {
        setIsSending(true);
        await sendHelpEmail(helpText);
        setHelpText("");
        message.success("Message has been sent. We'll reply via email shortly.");
      } catch (err) {
        message.error("Sorry, we could not send the help message. Please try again later.");
        throw err;
      } finally {
        setIsSending(false);
      }
    }
    props.onCancel();
  };

  return (
    <Modal
      title="Do you have any questions?"
      style={!props.centeredLayout ? positionStyle : undefined}
      open={props.isModalOpen}
      confirmLoading={isSending}
      mask={props.centeredLayout}
      width={320}
      footer={
        mode === "email" ? (
          <Space size="small">
            <Button onClick={props.onCancel}>Close</Button>
            <Button type="primary" onClick={sendHelp}>
              Send
            </Button>
          </Space>
        ) : null
      }
    >
      <Segmented
        options={[
          { label: "AI Assistant", value: "ai" },
          { label: "Email", value: "email" },
        ]}
        value={mode}
        onChange={(value) => setMode(value as HelpMode)}
        block
        style={{ marginBottom: 12 }}
      />

      {mode === "ai" ? (
        <HelpChat />
      ) : (
        <>
          <p>We are happy to help as soon as possible and will get back to you.</p>
          <Input.TextArea
            rows={6}
            value={helpText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setHelpText(e.target.value)}
          />
        </>
      )}
    </Modal>
  );
}
