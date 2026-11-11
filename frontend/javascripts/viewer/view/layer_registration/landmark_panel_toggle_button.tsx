import { TableOutlined } from "@ant-design/icons";
import { ToggleButton } from "viewer/view/components/button_component";
import {
  sendCommandToLayerRegistrationPage,
  useLayerRegistrationViewState,
} from "./layer_registration_view_state";

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
