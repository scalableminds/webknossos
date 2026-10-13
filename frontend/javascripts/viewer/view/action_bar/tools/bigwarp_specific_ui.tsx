import Icon, { SaveOutlined, TableOutlined } from "@ant-design/icons";
import AffineTransformationIcon from "@images/icons/icon-affine-transformation.svg?react";
import NoTransformationIcon from "@images/icons/icon-no-transformation.svg?react";
import { Space } from "antd";
import { useState } from "react";
import {
  IS_LANDMARK_PANEL_INITIALLY_OPEN,
  isBigWarpPrimaryWorker,
  sendCommandToAlignmentPage,
} from "viewer/view/align_datasets/bigwarp_protocol";
import { useAlignmentViewState } from "viewer/view/align_datasets/bigwarp_worker";
import ButtonComponent, { ToggleButton } from "viewer/view/components/button_component";
import { ACTIONBAR_MARGIN_LEFT, NARROW_BUTTON_STYLE } from "./tool_helpers";

// Switches between showing the other layer aligned to this worker's layer and untransformed.
// Uses the icons of the transform button in the layer settings.
function TransformToggleButton() {
  const { isTransformShown, isAlignmentAvailable } = useAlignmentViewState();
  const isTransformed = isAlignmentAvailable && isTransformShown;
  const title = !isAlignmentAvailable
    ? "Place at least three landmark pairs to align the layers."
    : isTransformShown
      ? "The other layer is shown aligned to this one. Click to show it untransformed (T)."
      : "The other layer is shown untransformed. Click to show it aligned to this one (T).";
  return (
    <ButtonComponent
      onClick={() => sendCommandToAlignmentPage("toggleTransform")}
      disabled={!isAlignmentAvailable}
      style={NARROW_BUTTON_STYLE}
      title={title}
      variant={isTransformed ? "solid" : "outlined"}
      icon={<Icon component={isTransformed ? AffineTransformationIcon : NoTransformationIcon} />}
    />
  );
}

// Buttons for the dataset alignment page, shown in the toolbars of its workers. The alignment
// page has no toolbar of its own and performs the actions itself. Saving and the landmark panel
// concern both workers, so their buttons are only shown in the primary worker.
export function BigWarpAlignmentButtons() {
  // Only this button opens and closes the landmark panel, so tracking the state here is
  // enough.
  const [isLandmarkPanelOpen, setIsLandmarkPanelOpen] = useState(IS_LANDMARK_PANEL_INITIALLY_OPEN);

  const toggleLandmarkPanel = () => {
    setIsLandmarkPanelOpen((isOpen) => !isOpen);
    sendCommandToAlignmentPage("toggleLandmarkPanel");
  };

  return (
    <Space.Compact style={{ marginLeft: ACTIONBAR_MARGIN_LEFT }}>
      <TransformToggleButton />
      {isBigWarpPrimaryWorker() ? (
        <>
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
        </>
      ) : null}
    </Space.Compact>
  );
}
