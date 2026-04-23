import { sendHelpEmail } from "admin/rest_api";
import { Button, Flex, Input, message, Space, Typography } from "antd";
import type React from "react";
import { useState } from "react";

export function HelpEmail({ onCancel }: { onCancel: () => void }) {
  const [helpText, setHelpText] = useState("");
  const [isSending, setIsSending] = useState(false);

  const sendHelp = async () => {
    if (helpText.length > 0) {
      try {
        setIsSending(true);
        await sendHelpEmail(helpText);
        setHelpText("");
        message.success("Message has been sent. We'll reply via email shortly.");
        onCancel();
      } catch {
        message.error("Sorry, we could not send the help message. Please try again later.");
      } finally {
        setIsSending(false);
      }
    }
  };

  return (
    <Space orientation="vertical">
      <Typography.Text>
        We are happy to help as soon as possible and will get back to you via email.
      </Typography.Text>
      <Input.TextArea
        rows={6}
        value={helpText}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setHelpText(e.target.value)}
      />
      <Flex gap="small" justify="end">
        <Button onClick={onCancel}>Close</Button>
        <Button type="primary" onClick={sendHelp} loading={isSending}>
          Send
        </Button>
      </Flex>
    </Space>
  );
}
