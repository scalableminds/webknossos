import { Typography, theme } from "antd";
import type React from "react";
import type { CSSProperties } from "react";

export const smallCapsStyle: CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

/** Body copy in colorTextSecondary. type="secondary" would resolve to the dimmer colorTextTertiary, see theme.ts. */
export function SecondaryText({ children }: { children: React.ReactNode }) {
  const { cssVar } = theme.useToken();
  return <Typography.Text style={{ color: cssVar.colorTextSecondary }}>{children}</Typography.Text>;
}
