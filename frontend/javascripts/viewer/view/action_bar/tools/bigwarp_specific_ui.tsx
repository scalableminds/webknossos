import Icon, { TableOutlined } from "@ant-design/icons";
import AffineTransformationIcon from "@images/icons/icon-affine-transformation.svg?react";
import NoTransformationIcon from "@images/icons/icon-no-transformation.svg?react";
import { Space } from "antd";
import { sendCommandToAlignmentPage } from "viewer/view/align_datasets/bigwarp_protocol";
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
    <ToggleButton
      active={isTransformed}
      onClick={() => sendCommandToAlignmentPage("toggleTransform")}
      disabled={!isAlignmentAvailable}
      style={NARROW_BUTTON_STYLE}
      title={title}
      icon={<Icon component={isTransformed ? AffineTransformationIcon : NoTransformationIcon} />}
    />
  );
}

// Buttons for the dataset alignment page, shown in the toolbars of its workers. The alignment
// page has no toolbar of its own and performs the actions itself.
export function BigWarpAlignmentButtons() {
  return (
    <Space.Compact style={{ marginLeft: ACTIONBAR_MARGIN_LEFT }}>
      <TransformToggleButton />
    </Space.Compact>
  );
}

// Opens and closes the landmark panel, which is right of the secondary (right) worker. Shown
// at the right end of that worker's navbar, like the button that opens the right sidebar in
// the normal viewer.
export function LandmarkPanelToggleButton() {
  const { isLandmarkPanelOpen } = useAlignmentViewState();
  return (
    <ToggleButton
      active={isLandmarkPanelOpen}
      onClick={() => sendCommandToAlignmentPage("toggleLandmarkPanel")}
      title={`${isLandmarkPanelOpen ? "Hide" : "Show"} the landmark table and the alignment tools`}
      icon={<TableOutlined style={{ fontSize: 18 }} />}
    />
  );
}
