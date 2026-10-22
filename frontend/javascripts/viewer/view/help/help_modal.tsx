import { CloseOutlined, ExpandAltOutlined, PlusOutlined, ShrinkOutlined } from "@ant-design/icons";
import { Button, Flex, Modal, Segmented, Tooltip } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import { type CSSProperties, useState } from "react";
import { clearHelpChatSession, HelpChat } from "./help_chat";
import { HelpEmail } from "./help_email";

type HelpMode = "ai" | "email";

type HelpModalProps = {
  isModalOpen: boolean;
  onCancel: () => void;
};

export function HelpModal(props: HelpModalProps) {
  const aiAgentEnabled = Boolean(features().supportAiAgentUrl);
  const [mode, setMode] = useState<HelpMode>(aiAgentEnabled ? "ai" : "email");
  const [isExpanded, setIsExpanded] = useState(false);
  const [chatResetKey, setChatResetKey] = useState(0);
  const navbarHeight = useWkSelector((state) => state.uiInformation.navbarHeight);
  // Dock the panel to the top right, right below the navbar's help button.
  const positionStyle: CSSProperties = { right: 10, top: navbarHeight + 8, position: "fixed" };

  const modalTitle = (
    <Flex align="center" gap={4} style={{ paddingRight: 8 }}>
      <span style={{ flex: 1 }}>Do you have any questions?</span>
      {aiAgentEnabled && mode === "ai" && (
        <Tooltip title="New conversation">
          <Button
            icon={<PlusOutlined />}
            size="small"
            type="text"
            onClick={() => {
              clearHelpChatSession();
              setChatResetKey((k) => k + 1);
            }}
          />
        </Tooltip>
      )}
      <Tooltip title={isExpanded ? "Smaller" : "Larger"}>
        <Button
          icon={isExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
          size="small"
          type="text"
          onClick={() => setIsExpanded((v) => !v)}
        />
      </Tooltip>
      <Button icon={<CloseOutlined />} size="small" type="text" onClick={props.onCancel} />
    </Flex>
  );

  return (
    <Modal
      title={modalTitle}
      style={positionStyle}
      open={props.isModalOpen}
      mask={false}
      onCancel={props.onCancel}
      // This renders as a panel docked to the top right rather than a centered dialog, and
      // toggles between a compact and an expanded size.
      // biome-ignore lint/plugin: deliberately off the ModalWidth scale, see above
      width={isExpanded ? 600 : 400}
      footer={null}
      closable={false}
    >
      {aiAgentEnabled && (
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
      )}

      {/* Both tabs fill the same fixed height so switching between them doesn't resize the
      panel. Portrait proportions like a chat window, but never taller than the viewport
      below the navbar allows. */}
      <div style={{ height: `min(${isExpanded ? 600 : 440}px, calc(100vh - 200px))` }}>
        {mode === "ai" ? <HelpChat key={chatResetKey} /> : <HelpEmail onCancel={props.onCancel} />}
      </div>
    </Modal>
  );
}
