import Icon from "@ant-design/icons";
import WkLogoIcon from "@images/wk-logo.svg?react";
import { Avatar, Flex, Typography, theme } from "antd";
import type { CSSProperties, ReactNode } from "react";

// Building blocks shared by the chat and the email screens of the help panel.

export function AssistantAvatar({ size }: { size: number }) {
  const { cssVar } = theme.useToken();
  return (
    <Avatar
      size={size}
      icon={<Icon component={WkLogoIcon} />}
      style={{ background: cssVar.colorBgLayout, color: cssVar.colorPrimary, flexShrink: 0 }}
    />
  );
}

/** A small monospace label, e.g. above a list of suggestions. Set `caps={false}` for hints. */
export function Eyebrow({ children, caps = true }: { children: ReactNode; caps?: boolean }) {
  const { token } = theme.useToken();
  return (
    <Typography.Text
      type="secondary"
      style={{
        fontFamily: token.fontFamilyCode,
        fontSize: token.fontSizeSM,
        // Also when it sits inside a bold title, like the one of the help panel.
        fontWeight: "normal",
        letterSpacing: caps ? "0.12em" : "0.04em",
        textTransform: caps ? "uppercase" : undefined,
      }}
    >
      {children}
    </Typography.Text>
  );
}

/** The large heading of a help panel screen and its explanation below. */
export function PanelGreeting({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap="small">
      <Typography.Title level={2} style={{ margin: 0, lineHeight: 1.1 }}>
        {title}
      </Typography.Title>
      <Typography.Text type="secondary" style={{ fontSize: token.fontSizeLG }}>
        {children}
      </Typography.Text>
    </Flex>
  );
}

export function greetingTitle(firstName: string | undefined) {
  return firstName ? (
    <>
      Hi {firstName},<br />
      how can we help?
    </>
  ) : (
    "How can we help?"
  );
}

/**
 * Looks like a single outlined input, but hosts a borderless textarea together with further
 * controls (the send button, the "include conversation" checkbox). See _help_panel.less.
 */
export function InputFrame({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="help-panel-input-frame" style={style}>
      {children}
    </div>
  );
}
