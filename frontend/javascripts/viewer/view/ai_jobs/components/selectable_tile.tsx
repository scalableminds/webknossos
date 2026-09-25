import { CheckCircleFilled } from "@ant-design/icons";
import { Card, Flex, Tag, Typography, theme } from "antd";
import type React from "react";

type SelectionState = { isSelected: boolean; isDisabled?: boolean };

function useTileStyle({ isSelected, isDisabled }: SelectionState): React.CSSProperties {
  const { cssVar } = theme.useToken();
  if (isDisabled) {
    return {
      border: `1px dashed ${cssVar.colorBorder}`,
      background: cssVar.colorFillAlter,
      cursor: "not-allowed",
    };
  }
  return {
    border: `1px solid ${isSelected ? cssVar.colorPrimary : cssVar.colorBorder}`,
    boxShadow: isSelected ? `0 0 0 1px ${cssVar.colorPrimary}` : undefined,
    background: isSelected ? cssVar.colorPrimaryBg : cssVar.colorBgContainer,
    cursor: "pointer",
  };
}

function getSelectionHandlers({ isSelected, isDisabled }: SelectionState, onSelect: () => void) {
  if (isDisabled) return { "aria-disabled": true };
  return {
    role: "radio",
    "aria-checked": isSelected,
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
      }
    },
  };
}

function SelectedIcon({ size }: { size: number }) {
  const { cssVar } = theme.useToken();
  return (
    <CheckCircleFilled
      style={{
        fontSize: size,
        color: cssVar.colorPrimary,
        background: cssVar.colorBgContainer,
        borderRadius: "50%",
      }}
    />
  );
}

/** A grid of selectable tiles, e.g. of AI models or job tasks. */
export function TileGrid({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
    >
      {children}
    </div>
  );
}

export function TileGroupLabel({ title, count }: { title: string; count: number }) {
  return (
    <Flex gap="small" style={{ marginBottom: 8 }}>
      <Typography.Text strong>{title}</Typography.Text>
      <Typography.Text type="secondary">{count}</Typography.Text>
    </Flex>
  );
}

type SelectableTileProps = SelectionState & {
  image?: string;
  title: string;
  description: React.ReactNode;
  // Limits long descriptions (e.g. user-provided model comments) to two lines.
  clampDescription?: boolean;
  onSelect: () => void;
};

export function SelectableTile({
  image,
  title,
  description,
  clampDescription,
  isSelected,
  isDisabled,
  onSelect,
}: SelectableTileProps) {
  const { cssVar } = theme.useToken();
  const selectionState = { isSelected, isDisabled };
  const tileStyle = useTileStyle(selectionState);
  return (
    <Card
      className="ai-job-tile"
      style={tileStyle}
      styles={{ body: { padding: "12px 16px 16px" } }}
      cover={
        image && (
          <div style={{ position: "relative", height: 96 }}>
            <img
              src={image}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                ...(isDisabled ? { opacity: 0.5, filter: "grayscale(1)" } : {}),
              }}
            />
            <div style={{ position: "absolute", top: 8, right: 8 }}>
              {isSelected && <SelectedIcon size={20} />}
              {isDisabled && <Tag style={{ marginInlineEnd: 0 }}>Coming soon</Tag>}
            </div>
          </div>
        )
      }
      {...getSelectionHandlers(selectionState, onSelect)}
    >
      <Typography.Text
        strong
        disabled={isDisabled}
        style={{ display: "block", marginBottom: 4, cursor: "inherit" }}
      >
        {title}
      </Typography.Text>
      <Typography.Paragraph
        disabled={isDisabled}
        ellipsis={clampDescription ? { rows: 2 } : false}
        style={{ margin: 0, color: isDisabled ? undefined : cssVar.colorTextSecondary }}
      >
        {description}
      </Typography.Paragraph>
    </Card>
  );
}

type SelectableRowProps = SelectionState & {
  avatar: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  onSelect: () => void;
};

/** A full-width selectable row for items without a preview image, e.g. custom AI models. */
export function SelectableRow({
  avatar,
  title,
  description,
  isSelected,
  onSelect,
}: SelectableRowProps) {
  const selectionState = { isSelected };
  const tileStyle = useTileStyle(selectionState);
  return (
    <Card
      className="ai-job-tile"
      style={tileStyle}
      styles={{ body: { padding: "12px 16px" } }}
      {...getSelectionHandlers(selectionState, onSelect)}
    >
      <Flex gap="small" align="center">
        {avatar}
        <Flex vertical flex={1} style={{ minWidth: 0 }}>
          {title}
          {description && (
            <Typography.Text type="secondary" ellipsis>
              {description}
            </Typography.Text>
          )}
        </Flex>
        {isSelected && <SelectedIcon size={18} />}
      </Flex>
    </Card>
  );
}
