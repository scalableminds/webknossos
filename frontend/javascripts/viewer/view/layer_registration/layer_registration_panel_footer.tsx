import { DownOutlined, EyeOutlined, LaptopOutlined } from "@ant-design/icons";
import { Button, Divider, Flex, Popover, Switch, Tooltip, Typography, theme } from "antd";
import type React from "react";
import { Keycap } from "viewer/view/components/keycap";
import { type LayerNames, OTHER_SIDE, SIDES, type Side } from "./layer_registration_helpers";

const VIEW_NAMES: Record<Side, string> = { fixed: "Left", moving: "Right" };

// The shortcuts work in the view under the mouse pointer (see layer_registration_worker.ts).
const SHORTCUTS = [
  { key: "T", action: "Show the other layer transformed or untransformed" },
  { key: "X", action: "Show or hide the other layer" },
  { key: "Y", action: "Move the other view to this position" },
];

function SwitchRow({
  label,
  shortcut,
  checked,
  disabled = false,
  onChange,
}: {
  label: React.ReactNode;
  shortcut?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <Flex justify="space-between" align="center" gap={12}>
      <Typography.Text type={disabled ? "secondary" : undefined}>{label}</Typography.Text>
      <Flex align="center" gap={8}>
        {shortcut != null ? <Keycap>{shortcut}</Keycap> : null}
        <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
      </Flex>
    </Flex>
  );
}

type ViewSettingsProps = {
  layerNames: LayerNames;
  isTransformAvailable: boolean;
  // Per view: whether it also shows the other layer, and whether that layer is transformed.
  // The same toggles are in the toolbar of each view.
  isOtherLayerVisible: Record<Side, boolean>;
  onToggleOtherLayer: (side: Side) => void;
  isTransformShown: Record<Side, boolean>;
  onToggleTransform: (side: Side) => void;
  // False if the layers can't be colored, see getOverlayLayerColors.
  canColorOverlay: boolean;
  isColorOverlayEnabled: boolean;
  onColorOverlayChange: (isEnabled: boolean) => void;
};

function ViewSettings({
  layerNames,
  isTransformAvailable,
  isOtherLayerVisible,
  onToggleOtherLayer,
  isTransformShown,
  onToggleTransform,
  canColorOverlay,
  isColorOverlayEnabled,
  onColorOverlayChange,
}: ViewSettingsProps) {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={8} style={{ width: 260 }}>
      {SIDES.map((side) => (
        <Flex key={side} vertical gap={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {VIEW_NAMES[side]} view · {layerNames[side]}
          </Typography.Text>
          <SwitchRow
            label={`Show ${layerNames[OTHER_SIDE[side]]}`}
            shortcut="X"
            checked={isOtherLayerVisible[side]}
            onChange={() => onToggleOtherLayer(side)}
          />
          <SwitchRow
            label="Transformed"
            shortcut="T"
            checked={isTransformAvailable && isTransformShown[side]}
            disabled={!isTransformAvailable}
            onChange={() => onToggleTransform(side)}
          />
        </Flex>
      ))}
      {canColorOverlay ? (
        <>
          <Divider style={{ margin: `${token.marginXXS}px 0` }} />
          <SwitchRow
            label="Green / magenta"
            checked={isColorOverlayEnabled}
            onChange={() => onColorOverlayChange(!isColorOverlayEnabled)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Where a view shows both layers, matching structures look gray, and structures that don't
            match show colored edges.
          </Typography.Text>
        </>
      ) : null}
    </Flex>
  );
}

function ShortcutList() {
  return (
    <Flex vertical style={{ width: 300 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, padding: "0 12px 4px" }}>
        In the view under the mouse pointer
      </Typography.Text>
      {SHORTCUTS.map(({ key, action }) => (
        <div className="info-tab-shortcut-row" key={key}>
          <div>{action}</div>
          <div className="info-tab-shortcut-keys">
            <Keycap>{key}</Keycap>
          </div>
        </div>
      ))}
    </Flex>
  );
}

/** The footer of the landmark panel: settings of the two views, the keyboard shortcuts, and
 * applying the transforms to the dataset.
 */
export function LayerRegistrationPanelFooter({
  applyDisabledReason,
  onApplyTransformToDataset,
  ...viewSettingsProps
}: ViewSettingsProps & {
  // Null if the transforms can be applied.
  applyDisabledReason: string | null;
  onApplyTransformToDataset: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <Flex
      justify="space-between"
      align="center"
      gap={8}
      style={{
        padding: `${token.paddingXS}px ${token.paddingSM}px`,
        borderTop: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flex gap={8}>
        <Popover
          trigger="click"
          placement="topLeft"
          content={<ViewSettings {...viewSettingsProps} />}
        >
          <Button icon={<EyeOutlined />}>
            View <DownOutlined style={{ fontSize: 10 }} />
          </Button>
        </Popover>
        <Popover trigger="click" placement="topLeft" content={<ShortcutList />}>
          <Tooltip title="Keyboard shortcuts">
            <Button icon={<LaptopOutlined />} aria-label="Keyboard shortcuts" />
          </Tooltip>
        </Popover>
      </Flex>
      <Tooltip title={applyDisabledReason}>
        <Button
          type="primary"
          onClick={onApplyTransformToDataset}
          disabled={applyDisabledReason != null}
        >
          Apply to dataset…
        </Button>
      </Tooltip>
    </Flex>
  );
}
