import { ArrowRightOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Button, Flex, Input, Skeleton, Typography, theme } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { getUid } from "libs/uid_generator";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ColorWKBlue } from "theme";
import type { APIUser } from "types/api_types";
import { HelpChatMarkdown } from "./help_chat_markdown";
import {
  AssistantAvatar,
  Eyebrow,
  greetingTitle,
  InputFrame,
  PanelGreeting,
} from "./help_panel_parts";

const STORAGE_MESSAGES_KEY = "wk_help_chat_messages";
const STORAGE_SESSION_KEY = "wk_help_chat_session_id";

// Offered on the welcome screen. Kept in one place so that they can depend on the context later.
const SUGGESTED_QUESTIONS = [
  "How do I upload a dataset?",
  "How do I download my annotation?",
  "How do I share an annotation with a colleague?",
];

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function clearHelpChatSession() {
  sessionStorage.removeItem(STORAGE_MESSAGES_KEY);
  sessionStorage.removeItem(STORAGE_SESSION_KEY);
}

function loadMessages(): ChatMessage[] {
  try {
    const stored = sessionStorage.getItem(STORAGE_MESSAGES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function loadSessionId(): string {
  const stored = sessionStorage.getItem(STORAGE_SESSION_KEY);
  if (stored) return stored;

  const id = getUid();
  sessionStorage.setItem(STORAGE_SESSION_KEY, id);

  return id;
}

async function askChatbot(
  chatInput: string,
  sessionId: string,
  activeUser?: APIUser | null,
): Promise<string> {
  const chatUrl = features().supportAiAgentUrl;
  if (!chatUrl) throw new Error("AI agent URL is not configured");

  const response = await fetch(chatUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metadata: {},
      action: "sendMessage",
      sessionId,
      chatInput,
      userName: `${activeUser?.firstName} ${activeUser?.lastName}`,
      userEmail: activeUser?.email,
    }),
  });

  if (!response.ok) throw new Error("Chat request failed");
  const data = await response.json();

  return data.output as string;
}

export type HelpChatSession = {
  messages: ChatMessage[];
  isLoading: boolean;
  send: (text: string) => Promise<void>;
  reset: () => void;
};

/**
 * The conversation with the assistant. It lives in the help panel (rather than in the chat
 * screen) so that the email screen can attach it, and it survives reloads via sessionStorage.
 */
export function useHelpChatSession(): HelpChatSession {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [isLoading, setIsLoading] = useState(false);
  const sessionId = useRef(loadSessionId());
  const activeUser = useWkSelector((state) => state.activeUser);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(messages));
  }, [messages]);

  const send = async (input: string) => {
    const text = input.trim();
    if (!text || isLoading) return;

    // `reset` starts a new session. A reply that belongs to the discarded one is dropped.
    const requestSessionId = sessionId.current;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsLoading(true);

    try {
      const reply = await askChatbot(text, sessionId.current, activeUser);
      if (sessionId.current !== requestSessionId) return;
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      if (sessionId.current !== requestSessionId) return;
      Toast.error("Could not reach the assistant. Please try again.");
    } finally {
      if (sessionId.current === requestSessionId) setIsLoading(false);
    }
  };

  const reset = () => {
    clearHelpChatSession();
    sessionId.current = loadSessionId();
    setMessages([]);
    setIsLoading(false);
  };

  return { messages, isLoading, send, reset };
}

function SuggestedQuestions({ onAsk }: { onAsk: (question: string) => void }) {
  const { cssVar } = theme.useToken();
  return (
    <Flex vertical gap="small">
      <Eyebrow>Try asking</Eyebrow>
      {SUGGESTED_QUESTIONS.map((question) => (
        <Button
          key={question}
          block
          size="large"
          icon={<ArrowRightOutlined style={{ color: cssVar.colorPrimaryText }} />}
          iconPlacement="end"
          style={{ justifyContent: "space-between" }}
          onClick={() => onAsk(question)}
        >
          {question}
        </Button>
      ))}
    </Flex>
  );
}

function ChatWelcome({ onAsk }: { onAsk: (question: string) => void }) {
  const firstName = useWkSelector((state) => state.activeUser?.firstName);
  return (
    <Flex vertical gap="large" style={{ marginTop: "auto" }}>
      <PanelGreeting title={greetingTitle(firstName)}>
        Ask about tools, datasets or your annotations. The assistant answers from the WEBKNOSSOS
        documentation.
      </PanelGreeting>
      <SuggestedQuestions onAsk={onAsk} />
    </Flex>
  );
}

function UserMessage({ content }: { content: string }) {
  const { cssVar } = theme.useToken();
  return (
    <Flex justify="end">
      <div
        style={{
          maxWidth: "78%",
          padding: `${cssVar.paddingXS} ${cssVar.paddingSM}`,
          borderRadius: cssVar.borderRadiusLG,
          borderBottomRightRadius: cssVar.borderRadiusXS,
          // The user message always has the (solid) WK blue background, hence the light text.
          background: ColorWKBlue,
          color: cssVar.colorTextLightSolid,
          whiteSpace: "pre-line",
        }}
      >
        {content}
      </div>
    </Flex>
  );
}

function AssistantMessage({ children }: { children: ReactNode }) {
  return (
    <Flex gap="small" align="start">
      <AssistantAvatar size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </Flex>
  );
}

function AssistantThinking() {
  return (
    <AssistantMessage>
      <Flex vertical gap="small" style={{ paddingTop: 3 }}>
        <Eyebrow caps={false}>Searching the documentation…</Eyebrow>
        <Skeleton active title={false} paragraph={{ rows: 2, width: ["88%", "60%"] }} />
      </Flex>
    </AssistantMessage>
  );
}

function ChatConversation({ chat }: { chat: HelpChatSession }) {
  return (
    <Flex vertical gap="middle" style={{ marginTop: "auto" }}>
      {chat.messages.map((message, i) =>
        message.role === "user" ? (
          <UserMessage key={i} content={message.content} />
        ) : (
          <AssistantMessage key={i}>
            <HelpChatMarkdown text={message.content} />
          </AssistantMessage>
        ),
      )}
      {chat.isLoading && <AssistantThinking />}
    </Flex>
  );
}

function ChatComposer({
  isConversationEmpty,
  isLoading,
  onSend,
}: {
  isConversationEmpty: boolean;
  isLoading: boolean;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const isEmpty = input.trim().length === 0;

  const send = () => {
    if (isEmpty || isLoading) return;
    onSend(input);
    setInput("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a line break. Enter also confirms an IME composition,
    // which must not send the message.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    <InputFrame style={{ flexDirection: "row", alignItems: "flex-end" }}>
      <Input.TextArea
        variant="borderless"
        size="large"
        autoSize={{ minRows: 1, maxRows: 6 }}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={isConversationEmpty ? "Ask a question…" : "Ask a follow-up…"}
        autoFocus
      />
      <Button
        type="primary"
        icon={<ArrowUpOutlined />}
        aria-label="Send"
        disabled={isEmpty}
        loading={isLoading}
        onClick={send}
      />
    </InputFrame>
  );
}

function ComposerHint({
  isConversationEmpty,
  onEmailTeam,
}: {
  isConversationEmpty: boolean;
  onEmailTeam: () => void;
}) {
  const { token } = theme.useToken();
  const textStyle = { fontSize: token.fontSizeSM };
  return (
    <Flex justify="space-between" gap="small" wrap style={{ padding: `0 ${token.paddingXXS}px` }}>
      {isConversationEmpty ? (
        <Eyebrow caps={false}>↵ send · ⇧↵ new line</Eyebrow>
      ) : (
        <Typography.Text type="secondary" style={textStyle}>
          Not the answer you need?
        </Typography.Text>
      )}
      <Typography.Text type="secondary" style={textStyle}>
        {isConversationEmpty && "Prefer a person? "}
        <Typography.Link onClick={onEmailTeam} style={textStyle}>
          {isConversationEmpty ? "Email the team →" : "Send this conversation to the team →"}
        </Typography.Link>
      </Typography.Text>
    </Flex>
  );
}

export function HelpChat({
  chat,
  onEmailTeam,
}: {
  chat: HelpChatSession;
  onEmailTeam: () => void;
}) {
  const { cssVar } = theme.useToken();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isConversationEmpty = chat.messages.length === 0 && !chat.isLoading;

  // Keep the latest message in view. Scrolling the container itself (instead of using
  // scrollIntoView) makes sure that the page around the panel never scrolls along.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [chat.messages, chat.isLoading]);

  return (
    <Flex vertical style={{ height: "100%" }}>
      <Flex
        vertical
        ref={scrollContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: isConversationEmpty
            ? `${cssVar.paddingXL} ${cssVar.paddingLG} ${cssVar.padding}`
            : `${cssVar.paddingMD} ${cssVar.paddingMD} ${cssVar.paddingSM}`,
        }}
      >
        {isConversationEmpty ? <ChatWelcome onAsk={chat.send} /> : <ChatConversation chat={chat} />}
      </Flex>
      <Flex
        vertical
        gap="small"
        style={{
          padding: `${cssVar.paddingSM} ${cssVar.padding} ${cssVar.padding}`,
          borderTop: isConversationEmpty ? undefined : `1px solid ${cssVar.colorSplit}`,
        }}
      >
        <ChatComposer
          isConversationEmpty={isConversationEmpty}
          isLoading={chat.isLoading}
          onSend={chat.send}
        />
        <ComposerHint isConversationEmpty={isConversationEmpty} onEmailTeam={onEmailTeam} />
      </Flex>
    </Flex>
  );
}
