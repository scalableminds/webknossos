import { CloseOutlined, ExpandAltOutlined, FormOutlined, ShrinkOutlined } from "@ant-design/icons";
import { Button, Flex, Modal, Segmented, Tooltip, theme } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import { type CSSProperties, useState } from "react";
import { HelpChat, useHelpChatSession } from "./help_chat";
import { HelpEmail, HelpEmailSent } from "./help_email";
import { AssistantAvatar, Eyebrow } from "./help_panel_parts";

type HelpMode = "ai" | "email";

const PANEL_GAP = 8;
// Vertical space of the panel around its content area: the header with the mode switch, plus
// a gap towards the bottom of the viewport.
const PANEL_CHROME_HEIGHT = 140;
const MIN_CONTENT_HEIGHT = 240;

type HelpModalProps = {
  isModalOpen: boolean;
  onCancel: () => void;
};

function CloseButton({ onClick }: { onClick: () => void }) {
  return <Button icon={<CloseOutlined />} type="text" aria-label="Close" onClick={onClick} />;
}

function HelpPanelTitle({
  mode,
  hasMessages,
  isExpanded,
  onNewChat,
  onToggleExpanded,
  onClose,
}: {
  mode: HelpMode;
  hasMessages: boolean;
  isExpanded: boolean;
  onNewChat: () => void;
  onToggleExpanded: () => void;
  onClose: () => void;
}) {
  return (
    <Flex align="center" gap="small">
      <AssistantAvatar size={32} />
      <Flex vertical style={{ flex: 1, minWidth: 0 }}>
        <span>Help</span>
        <Eyebrow>{mode === "ai" ? "WEBKNOSSOS assistant" : "A person replies by email"}</Eyebrow>
      </Flex>
      <Flex align="center">
        {mode === "ai" && hasMessages && (
          <Button icon={<FormOutlined />} type="text" onClick={onNewChat}>
            New chat
          </Button>
        )}
        <Tooltip title={isExpanded ? "Smaller" : "Larger"}>
          <Button
            icon={isExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
            type="text"
            aria-label={isExpanded ? "Smaller" : "Larger"}
            onClick={onToggleExpanded}
          />
        </Tooltip>
        <CloseButton onClick={onClose} />
      </Flex>
    </Flex>
  );
}

export function HelpModal(props: HelpModalProps) {
  const aiAgentEnabled = Boolean(features().supportAiAgentUrl);
  const [mode, setMode] = useState<HelpMode>(aiAgentEnabled ? "ai" : "email");
  const [isExpanded, setIsExpanded] = useState(false);
  // Whether the email attaches the assistant conversation. Preset when the user hands the
  // conversation over to the team from the chat.
  const [includeConversation, setIncludeConversation] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);
  const chat = useHelpChatSession();
  const { cssVar } = theme.useToken();
  const navbarHeight = useWkSelector((state) => state.uiInformation.navbarHeight);

  // Dock the panel to the top right, right below the navbar's help button.
  const positionStyle: CSSProperties = {
    right: 10,
    top: navbarHeight + PANEL_GAP,
    position: "fixed",
  };
  const availableContentHeight = `calc(100vh - ${navbarHeight + PANEL_GAP + PANEL_CHROME_HEIGHT}px)`;

  const switchMode = (nextMode: HelpMode, attachConversation = false) => {
    setMode(nextMode);
    setIncludeConversation(attachConversation);
    setIsEmailSent(false);
  };

  const title = isEmailSent ? (
    <Flex justify="end">
      <CloseButton onClick={props.onCancel} />
    </Flex>
  ) : (
    <Flex vertical gap="small">
      <HelpPanelTitle
        mode={mode}
        hasMessages={chat.messages.length > 0}
        isExpanded={isExpanded}
        onNewChat={chat.reset}
        onToggleExpanded={() => setIsExpanded((v) => !v)}
        onClose={props.onCancel}
      />
      {aiAgentEnabled && (
        <Segmented
          options={[
            { label: "AI Assistant", value: "ai" },
            { label: "Email", value: "email" },
          ]}
          value={mode}
          onChange={(value) => switchMode(value as HelpMode)}
          block
          style={{ marginRight: cssVar.paddingXS }}
        />
      )}
    </Flex>
  );

  let content;
  if (isEmailSent) {
    content = (
      <HelpEmailSent
        onBackToAssistant={aiAgentEnabled ? () => switchMode("ai") : undefined}
        onClose={props.onCancel}
      />
    );
  } else if (mode === "ai") {
    content = <HelpChat chat={chat} onEmailTeam={() => switchMode("email", true)} />;
  } else {
    content = (
      <HelpEmail
        isAssistantAvailable={aiAgentEnabled}
        transcript={aiAgentEnabled ? chat.messages : []}
        includeConversation={includeConversation}
        onToggleInclude={setIncludeConversation}
        onSent={() => setIsEmailSent(true)}
        onClose={props.onCancel}
      />
    );
  }

  return (
    <Modal
      title={title}
      style={positionStyle}
      open={props.isModalOpen}
      mask={false}
      onCancel={props.onCancel}
      // Re-opening the panel after sending an email shows a fresh form.
      afterOpenChange={(open) => {
        if (!open) setIsEmailSent(false);
      }}
      // This renders as a panel docked to the top right rather than a centered dialog, and
      // toggles between a compact and an expanded size.
      // biome-ignore lint/plugin: deliberately off the ModalWidth scale, see above
      width={isExpanded ? 720 : 540}
      footer={null}
      closable={false}
      styles={{
        container: { padding: 0, overflow: "hidden" },
        header: {
          margin: 0,
          padding: `${cssVar.paddingSM} ${cssVar.paddingSM} ${cssVar.paddingSM} ${cssVar.paddingMD}`,
          borderBottom: isEmailSent ? undefined : `1px solid ${cssVar.colorSplit}`,
        },
        body: { padding: 0 },
      }}
    >
      {/* All screens fill the same fixed height so switching between them doesn't resize the
      panel. Portrait proportions like a chat window, but never taller than the viewport
      below the navbar allows. The sent confirmation only takes the space it needs. */}
      <div
        style={{
          height: isEmailSent
            ? undefined
            : `min(${isExpanded ? 720 : 560}px, max(${MIN_CONTENT_HEIGHT}px, ${availableContentHeight}))`,
        }}
      >
        {content}
      </div>
    </Modal>
  );
}
