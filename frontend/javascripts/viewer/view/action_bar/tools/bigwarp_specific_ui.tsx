import { AimOutlined, SaveOutlined, TableOutlined } from "@ant-design/icons";
import { Space } from "antd";
import { useCallback, useState } from "react";
import ButtonComponent, { ToggleButton } from "viewer/view/components/button_component";
import { ACTIONBAR_MARGIN_LEFT, NARROW_BUTTON_STYLE } from "./tool_helpers";

// The alignment actions of the BigWarp-style dataset alignment tool (see
// viewer/view/layouting/align_datasets_view.tsx and BIGWARP_ALIGNMENT_PLAN.md §0.19).
// They live in the *primary* (left) worker iframe's toolbar, right where a tool's own
// sub-options are shown, because the coordinator page has no chrome of its own to put
// them in. All of them are implemented by the coordinator, so they are merely relayed
// up via postMessage here.
export type BigWarpCommand = "align" | "forceSave" | "toggleTable";

export function BigWarpAlignmentButtons() {
  const [isTableOpen, setIsTableOpen] = useState(false);

  const sendCommand = useCallback((command: BigWarpCommand) => {
    window.parent.postMessage({ type: "bigwarpCommand", command }, "*");
  }, []);

  const toggleTable = useCallback(() => {
    // This button is the only thing that opens/closes the coordinator's landmark panel,
    // so mirroring its state locally is enough to give the button proper on/off feedback
    // (no need for the coordinator to report the state back down).
    setIsTableOpen((isOpen) => !isOpen);
    sendCommand("toggleTable");
  }, [sendCommand]);

  return (
    <Space.Compact style={{ marginLeft: ACTIONBAR_MARGIN_LEFT }}>
      <ButtonComponent
        onClick={() => sendCommand("align")}
        style={NARROW_BUTTON_STYLE}
        title="Align the two layers by fitting a transform to the current landmark pairs (T)"
        icon={<AimOutlined />}
      />
      <ButtonComponent
        onClick={() => sendCommand("forceSave")}
        style={NARROW_BUTTON_STYLE}
        title="Save the landmark annotation right away instead of waiting for the next auto-save"
        icon={<SaveOutlined />}
      />
      <ToggleButton
        active={isTableOpen}
        onClick={toggleTable}
        style={NARROW_BUTTON_STYLE}
        title="Show/hide the landmark table and the remaining alignment tools"
        icon={<TableOutlined />}
      />
    </Space.Compact>
  );
}
