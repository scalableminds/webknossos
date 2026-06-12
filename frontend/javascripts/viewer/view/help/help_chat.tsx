import { Flex, Input, Spin, Typography } from "antd";
import features from "features";
import Markdown from "libs/markdown_adapter";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { ColorWKBlue } from "theme";
import type { APIUser } from "types/api_types";

const CHAT_MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", fontSize: 15, margin: "4px 0 2px" }}>{children}</strong>
  ),
  h2: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", fontSize: 14, margin: "4px 0 2px" }}>{children}</strong>
  ),
  h3: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "4px 0 2px" }}>{children}</strong>
  ),
  h4: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "4px 0 2px" }}>{children}</strong>
  ),
  h5: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "4px 0 2px" }}>{children}</strong>
  ),
  h6: ({ children }: { children: ReactNode }) => (
    <strong style={{ display: "block", margin: "4px 0 2px" }}>{children}</strong>
  ),
  ul: ({ children }: { children: ReactNode }) => (
    <ul style={{ paddingLeft: 16, margin: "2px 0" }}>{children}</ul>
  ),
  ol: ({ children }: { children: ReactNode }) => (
    <ol style={{ paddingLeft: 16, margin: "2px 0" }}>{children}</ol>
  ),
};

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
    whiteSpace: message.role === "user" ? "pre-line" : "normal",
    borderBottomRightRadius: message.role === "user" ? 2 : 12,
    borderBottomLeftRadius: message.role === "assistant" ? 2 : 12,
  };

  return (
    <Flex justify={message.role === "user" ? "end" : "start"}>
      <div style={bubbleStyle}>
        {isLoading ? (
          <Spin size="small" />
        ) : message.role === "assistant" ? (
          <Markdown components={CHAT_MARKDOWN_COMPONENTS}>{message.content}</Markdown>
        ) : (
          message.content
        )}
      </div>
    </Flex>
  );
}

export function HelpChat({ isExpanded = false }: { isExpanded?: boolean }) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const stored = loadMessages();
    if (stored.length > 0) return stored;
    return [
      {
        role: "assistant",
        content:
          'Do you mean nodes/edges (skeleton), voxels/segments (volume), 3D meshes or agglomerates (proofreading)? Below are the common delete actions and how to do them.\n\n---\n\n## General\n\n[Right-click](https://docs.webknossso.org) to open the context menu — most delete actions are available there.\n\n---\n\n## Skeleton (nodes / edges / trees)\n\n**Delete a node:** Right-click the node → "Delete this Node" or press `Del`.\n- *Classic Controls:* select node (`Shift + Left Click`) then press `Del`.\n\n**Delete an edge (split a tree):** Select first node (`Left Click`), right-click second node → "Delete Edge to this Node".\n- *Classic Controls:* select first node with `Shift + Left Click`, then `Shift + Ctrl + Left Click` on the second node to delete the connection.\n\n**Merge trees (create edge):** Select first node, right-click second node → "Create Edge & Merge with this Tree".\n- *Classic:* `Shift + Alt + Left Click`.\n\n**Delete branchpoint:** Use `J` (delete branch point) or the node context menu; mark branchpoint with `B`.\n\n---\n\n## Volume (voxels / segments)\n\n**Remove voxels** using the erase/brush tools:\n- `Ctrl/Cmd + Shift + Left Mouse Drag` to remove voxels from the current segment.\n- *Classic Controls:* `Right Mouse Drag` removes voxels.\n\n**Delete / split segments (proofreading):** See below.\n\n---\n\n## 3D meshes\n\nUse the mesh context menu in the 3D viewport to reload, hide, or remove a mesh (right-click the mesh).\n\n---\n\n## Proofreading / segmentation edits\n\n- **Merge segments:** Left-click to mark the active segment, then right-click the other segment → "Merge With Active Segment".\n- **Split (min-cut):** Left-click to mark active segment, right-click target → "Split from active segment (Min-Cut)".\n- **Multi-split mode:** Press `M` (or click scissor), assign partitions, then `Enter` or right-click → "Split partitions".\n- **Split from all neighbors:** Right-click a segment → "Split from all neighboring segments".\n\n> ⚠️ **Important:** Undo/redo is **not** supported for proofreading operations. To revert, use **Restore Older Version** (Save dropdown).\n\n---\n\nIf something else needs deleting (bounding box, entire tree, project assets, etc.), tell me which object and which view/tool you\'re using and I\'ll give the exact steps. If you think you found a bug while deleting, email [support@webknossos.org](mailto:support@webknossos.org).',
      },
    ];
  });
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
