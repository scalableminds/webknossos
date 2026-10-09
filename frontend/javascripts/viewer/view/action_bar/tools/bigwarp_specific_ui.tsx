import { AimOutlined, SaveOutlined, TableOutlined } from "@ant-design/icons";
import { Space } from "antd";
import { useState } from "react";
import { sendCommandToAlignmentPage } from "viewer/view/align_datasets/bigwarp_protocol";
import ButtonComponent, { ToggleButton } from "viewer/view/components/button_component";
import { ACTIONBAR_MARGIN_LEFT, NARROW_BUTTON_STYLE } from "./tool_helpers";

// Buttons for the dataset alignment page, shown in the toolbar of its primary worker.
// The alignment page has no toolbar of its own and performs the actions itself.
export function BigWarpAlignmentButtons() {
  // Only this button opens and closes the landmark panel, so tracking the state here is
  // enough.
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(false);

  const toggleLandmarkPanel = () => {
    setIsLandmarkPanelOpen((isOpen) => !isOpen);
    sendCommandToAlignmentPage("toggleLandmarkPanel");
  };

  return (
    <Space.Compact style={{ marginLeft: ACTIONBAR_MARGIN_LEFT }}>
      <ButtonComponent
        onClick={() => sendCommandToAlignmentPage("align")}
        style={NARROW_BUTTON_STYLE}
        title="Align the two layers by fitting a transform to the current landmark pairs (T)"
        icon={<AimOutlined />}
      />
      <ButtonComponent
        onClick={() => sendCommandToAlignmentPage("forceSave")}
        style={NARROW_BUTTON_STYLE}
        title="Save the landmark annotation right away instead of waiting for the next auto-save"
        icon={<SaveOutlined />}
      />
      <ToggleButton
        active={isLandmarkPanelOpen}
        onClick={toggleLandmarkPanel}
        style={NARROW_BUTTON_STYLE}
        title="Show/hide the landmark table and the remaining alignment tools"
        icon={<TableOutlined />}
      />
    </Space.Compact>
  );
}
