import { ArrowRightOutlined } from "@ant-design/icons";
import { sendHelpEmail } from "admin/rest_api";
import { Button, Checkbox, Flex, Input, Typography, theme } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import { type ReactNode, useState } from "react";
import type { ChatMessage } from "./help_chat";
import { greetingTitle, InputFrame, PanelGreeting } from "./help_panel_parts";

const STORAGE_DRAFT_KEY = "wk_help_email_draft";

function formatTranscript(messages: ChatMessage[]): string {
  const lines = messages.map(
    ({ role, content }) => `${role === "user" ? "User" : "Assistant"}: ${content}`,
  );
  return `\n\n---\nAssistant conversation:\n\n${lines.join("\n")}`;
}

/** The email text, kept in sessionStorage like the chat, so that it survives closing the panel. */
function useEmailDraft() {
  const [draft, setDraft] = useState(() => sessionStorage.getItem(STORAGE_DRAFT_KEY) ?? "");

  // Stored right away instead of in an effect: sending the email unmounts this form, so an
  // effect would never get to clear the draft.
  const updateDraft = (text: string) => {
    setDraft(text);
    if (text) sessionStorage.setItem(STORAGE_DRAFT_KEY, text);
    else sessionStorage.removeItem(STORAGE_DRAFT_KEY);
  };

  return [draft, updateDraft] as const;
}

function ActiveUserEmail() {
  const { cssVar } = theme.useToken();
  const email = useWkSelector((state) => state.activeUser?.email);
  return <span style={{ color: cssVar.colorText }}>{email}</span>;
}

function IncludeConversationCheckbox({
  messageCount,
  checked,
  onChange,
}: {
  messageCount: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { cssVar } = theme.useToken();
  return (
    <div
      style={{
        padding: `${cssVar.paddingXS} ${cssVar.paddingSM}`,
        borderRadius: cssVar.borderRadius,
        background: cssVar.colorFillQuaternary,
      }}
    >
      <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)}>
        Include my assistant conversation{" "}
        <Typography.Text type="secondary">
          · {messageCount} {pluralize("message", messageCount)}
        </Typography.Text>
      </Checkbox>
    </div>
  );
}

function PanelFooter({ children }: { children: ReactNode }) {
  const { cssVar } = theme.useToken();
  return (
    <Flex
      align="center"
      gap="small"
      style={{
        padding: `${cssVar.paddingSM} ${cssVar.padding} ${cssVar.padding} ${cssVar.paddingLG}`,
        borderTop: `1px solid ${cssVar.colorSplit}`,
      }}
    >
      {children}
    </Flex>
  );
}

type HelpEmailProps = {
  // Whether the instance offers the AI assistant. Without it, this is the only help screen.
  isAssistantAvailable: boolean;
  transcript: ChatMessage[];
  includeConversation: boolean;
  onToggleInclude: (include: boolean) => void;
  onSent: () => void;
  onClose: () => void;
};

export function HelpEmail({
  isAssistantAvailable,
  transcript,
  includeConversation,
  onToggleInclude,
  onSent,
  onClose,
}: HelpEmailProps) {
  const { cssVar, token } = theme.useToken();
  const [helpText, setHelpText] = useEmailDraft();
  const [isSending, setIsSending] = useState(false);
  const firstName = useWkSelector((state) => state.activeUser?.firstName);
  const attachesConversation = includeConversation && transcript.length > 0;

  const send = async () => {
    if (helpText.trim().length === 0) return;
    try {
      setIsSending(true);
      await sendHelpEmail(
        attachesConversation ? helpText + formatTranscript(transcript) : helpText,
      );
      setHelpText("");
      Toast.success("Message has been sent. We'll reply via email shortly.");
      onSent();
    } catch {
      Toast.error("Sorry, we could not send the help message. Please try again later.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Flex vertical style={{ height: "100%" }}>
      <Flex
        vertical
        gap="large"
        style={{
          flex: 1,
          minHeight: 0,
          padding: `${cssVar.paddingXL} ${cssVar.paddingLG} ${cssVar.padding}`,
        }}
      >
        {isAssistantAvailable ? (
          <PanelGreeting title="Write to the team.">
            A person from the WEBKNOSSOS team reads every message and replies to <ActiveUserEmail />
            .
          </PanelGreeting>
        ) : (
          <PanelGreeting title={greetingTitle(firstName)}>
            Questions, problems or ideas. We reply to <ActiveUserEmail />.
          </PanelGreeting>
        )}
        <InputFrame style={{ flex: 1, minHeight: 0 }}>
          <Input.TextArea
            variant="borderless"
            size="large"
            style={{ flex: 1, resize: "none" }}
            value={helpText}
            onChange={(event) => setHelpText(event.target.value)}
            placeholder="What are you trying to do, and what happened instead?"
            autoFocus
          />
          {transcript.length > 0 && (
            <IncludeConversationCheckbox
              messageCount={transcript.length}
              checked={includeConversation}
              onChange={onToggleInclude}
            />
          )}
        </InputFrame>
      </Flex>
      <PanelFooter>
        {!isAssistantAvailable && (
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Or browse the{" "}
            <Typography.Link
              href="https://docs.webknossos.org"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: token.fontSizeSM }}
            >
              documentation
            </Typography.Link>
          </Typography.Text>
        )}
        <Flex gap="small" style={{ marginLeft: "auto" }}>
          <Button type="text" onClick={onClose}>
            Close
          </Button>
          <Button
            type="primary"
            icon={<ArrowRightOutlined />}
            iconPlacement="end"
            disabled={helpText.trim().length === 0}
            loading={isSending}
            onClick={send}
          >
            Send message
          </Button>
        </Flex>
      </PanelFooter>
    </Flex>
  );
}
