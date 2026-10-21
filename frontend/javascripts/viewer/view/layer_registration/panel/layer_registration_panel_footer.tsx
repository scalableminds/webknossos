import { DownOutlined, EyeOutlined, LaptopOutlined } from "@ant-design/icons";
import { Button, Divider, Flex, Popover, Switch, Tooltip, Typography, theme } from "antd";
import capitalize from "lodash-es/capitalize";
import type React from "react";
import { Keycap } from "viewer/view/components/keycap";
import {
  type LayerNames,
  OTHER_SIDE,
  SIDES,
  VIEW_NAMES,
} from "../helpers/layer_registration_helpers";
import type { ViewSettings } from "../workspace/hooks/use_layer_registration_view_settings";

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

type ViewSettingsContentProps = {
  layerNames: LayerNames;
  isTransformAvailable: boolean;
  // The same switches are in the toolbar of each view.
  viewSettings: ViewSettings;
};

function ViewSettingsContent({
  layerNames,
  isTransformAvailable,
  viewSettings,
}: ViewSettingsContentProps) {
  const { token } = theme.useToken();
  const {
    isOtherLayerVisible,
    isTransformShown,
    canColorOverlay,
    isColorOverlayEnabled,
    toggleOtherLayer,
    toggleTransform,
    setIsColorOverlayEnabled,
  } = viewSettings;
  return (
    <Flex vertical gap={8} style={{ width: 260 }}>
      {SIDES.map((side) => (
        <Flex key={side} vertical gap={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {capitalize(VIEW_NAMES[side])} view · {layerNames[side]}
          </Typography.Text>
          <SwitchRow
            label={`Show ${layerNames[OTHER_SIDE[side]]}`}
            shortcut="X"
            checked={isOtherLayerVisible[side]}
            onChange={() => toggleOtherLayer(side)}
          />
          <SwitchRow
            label="Transformed"
            shortcut="T"
            checked={isTransformAvailable && isTransformShown[side]}
            disabled={!isTransformAvailable}
            onChange={() => toggleTransform(side)}
          />
        </Flex>
      ))}
      {canColorOverlay ? (
        <>
          <Divider style={{ margin: `${token.marginXXS}px 0` }} />
          <SwitchRow
            label="Green / magenta"
            checked={isColorOverlayEnabled}
            onChange={() => setIsColorOverlayEnabled(!isColorOverlayEnabled)}
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
  ...viewSettingsContentProps
}: ViewSettingsContentProps & {
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
          content={<ViewSettingsContent {...viewSettingsContentProps} />}
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
