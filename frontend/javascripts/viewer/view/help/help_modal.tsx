import { CloseOutlined, ExpandAltOutlined, PlusOutlined, ShrinkOutlined } from "@ant-design/icons";
import { Button, Flex, Modal, Segmented, Tooltip } from "antd";
import features from "features";
import { type CSSProperties, useState } from "react";
import { clearHelpChatSession, HelpChat } from "./help_chat";
import { HelpEmail } from "./help_email";

type HelpMode = "ai" | "email";

type HelpModalProps = {
  isModalOpen: boolean;
  centeredLayout: boolean;
  onCancel: () => void;
};

export function HelpModal(props: HelpModalProps) {
  const aiAgentEnabled = Boolean(features().supportAiAgentUrl);
  const [mode, setMode] = useState<HelpMode>(aiAgentEnabled ? "ai" : "email");
  const [isExpanded, setIsExpanded] = useState(false);
  const [chatResetKey, setChatResetKey] = useState(0);
  const positionStyle: CSSProperties = { right: 10, bottom: 40, top: "auto", position: "fixed" };

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
      style={!props.centeredLayout ? positionStyle : undefined}
      open={props.isModalOpen}
      mask={props.centeredLayout}
      onCancel={props.onCancel}
      width={isExpanded ? 720 : 540}
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

      {mode === "ai" ? (
        <HelpChat key={chatResetKey} isExpanded={isExpanded} />
      ) : (
        <HelpEmail onCancel={props.onCancel} />
      )}
    </Modal>
  );
}
