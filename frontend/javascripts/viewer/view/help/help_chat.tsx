import { Flex, Input, Spin, Typography } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ColorWKBlue } from "theme";
import type { APIUser } from "types/api_types";

const STORAGE_MESSAGES_KEY = "wk_help_chat_messages";
const STORAGE_SESSION_KEY = "wk_help_chat_session_id";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function clearHelpChatSession() {
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

  const id = crypto.randomUUID();
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

function ChatMessageBubble({
  message,
  isLoading = false,
}: {
  message: ChatMessage;
  isLoading?: boolean;
}) {
  const bubbleStyle: CSSProperties = {
    maxWidth: "82%",
    padding: "6px 10px",
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.4,
    background: message.role === "user" ? ColorWKBlue : "var(--ant-color-bg-layout)",
    color: message.role === "user" ? "#fff" : "var(--ant-color-text)",
    whiteSpace: "pre-line",
    borderBottomRightRadius: message.role === "user" ? 2 : 12,
    borderBottomLeftRadius: message.role === "assistant" ? 2 : 12,
  };

  return (
    <Flex justify={message.role === "user" ? "end" : "start"}>
      <div style={bubbleStyle}>{isLoading ? <Spin size="small" /> : message.content}</div>
    </Flex>
  );
}

export function HelpChat({ isExpanded = false }: { isExpanded?: boolean }) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(loadMessages);
  const [chatInput, setChatInput] = useState("");
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  const sessionId = useRef(loadSessionId());
  const chatEndRef = useRef<HTMLDivElement>(null);

  const activeUser = useWkSelector((state) => state.activeUser);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_MESSAGES_KEY, JSON.stringify(chatMessages));
  }, [chatMessages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isLoadingChat]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || isLoadingChat) return;

    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsLoadingChat(true);

    try {
      const reply = await askChatbot(text, sessionId.current, activeUser);
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      Toast.error("Could not reach the assistant. Please try again.");
    } finally {
      setIsLoadingChat(false);
    }
  };

  return (
    <>
      <Flex
        vertical
        gap={6}
        style={{
          height: isExpanded ? 440 : 220,
          overflowY: "auto",
          marginBottom: 8,
        }}
      >
        {chatMessages.length === 0 && !isLoadingChat && (
          <Typography.Text type="secondary" style={{ textAlign: "center", margin: "auto" }}>
            Ask me anything about WEBKNOSSOS!
          </Typography.Text>
        )}
        {chatMessages.map((msg, i) => (
          <ChatMessageBubble key={i} message={msg} />
        ))}
        {isLoadingChat && (
          <ChatMessageBubble message={{ role: "assistant", content: "" }} isLoading />
        )}
        <div ref={chatEndRef} />
      </Flex>
      <Input.Search
        value={chatInput}
        onChange={(e) => setChatInput(e.target.value)}
        onSearch={() => sendChat()}
        placeholder="Type your question…"
        enterButton="Send"
        loading={isLoadingChat}
      />
    </>
  );
}
