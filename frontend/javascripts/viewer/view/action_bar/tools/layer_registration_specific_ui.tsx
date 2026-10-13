import Icon, { TableOutlined } from "@ant-design/icons";
import AffineTransformationIcon from "@images/icons/icon-affine-transformation.svg?react";
import NoTransformationIcon from "@images/icons/icon-no-transformation.svg?react";
import { Space } from "antd";
import { ToggleButton } from "viewer/view/components/button_component";
import { sendCommandToLayerRegistrationPage } from "viewer/view/layer_registration/layer_registration_protocol";
import { useLayerRegistrationViewState } from "viewer/view/layer_registration/layer_registration_worker";
import { ACTIONBAR_MARGIN_LEFT, NARROW_BUTTON_STYLE } from "./tool_helpers";

// Switches between showing the other layer transformed onto this worker's layer and
// untransformed.
// Uses the icons of the transform button in the layer settings.
function TransformToggleButton() {
  const { isTransformShown, isTransformAvailable } = useLayerRegistrationViewState();
  const isTransformed = isTransformAvailable && isTransformShown;
  const title = !isTransformAvailable
    ? "Place at least three landmark pairs to estimate a transform."
    : isTransformShown
      ? "The other layer is shown transformed onto this one. Click to show it untransformed (T)."
      : "The other layer is shown untransformed. Click to show it transformed onto this one (T).";
  return (
    <ToggleButton
      active={isTransformed}
      onClick={() => sendCommandToLayerRegistrationPage("toggleTransform")}
      disabled={!isTransformAvailable}
      style={NARROW_BUTTON_STYLE}
      title={title}
      icon={<Icon component={isTransformed ? AffineTransformationIcon : NoTransformationIcon} />}
    />
  );
}

// Buttons for the layer registration page, shown in the toolbars of its workers. The page has
// no toolbar of its own and performs the actions itself.
export function LayerRegistrationButtons() {
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
  const { isLandmarkPanelOpen } = useLayerRegistrationViewState();
  return (
    <ToggleButton
      active={isLandmarkPanelOpen}
      onClick={() => sendCommandToLayerRegistrationPage("toggleLandmarkPanel")}
      title={`${isLandmarkPanelOpen ? "Hide" : "Show"} the landmark table and the layer registration tools`}
      icon={<TableOutlined style={{ fontSize: 18 }} />}
    />
  );
}
