import { TableOutlined } from "@ant-design/icons";
import { useWkSelector } from "libs/react_hooks";
import { ToggleButton } from "viewer/view/components/button_component";
import { sendCommandToLayerRegistrationPage } from "./layer_registration_protocol";

// Opens and closes the landmark panel, which is right of the moving (right) landmark iframe. Shown
// at the right end of the navbar of that landmark iframe, like the button that opens the right
// sidebar in the normal viewer. Hidden until the page sent its view state.
export function LandmarkPanelToggleButton() {
  const viewState = useWkSelector((state) => state.layerRegistrationLandmarkIframe.viewState);
  if (viewState == null) {
    return null;
  }
  const { isLandmarkPanelOpen } = viewState;
  return (
    <ToggleButton
      active={isLandmarkPanelOpen}
      onClick={() => sendCommandToLayerRegistrationPage("toggleLandmarkPanel")}
      title={`${isLandmarkPanelOpen ? "Hide" : "Show"} the landmark table and the layer registration tools`}
      icon={<TableOutlined style={{ fontSize: 18 }} />}
    />
  );
}
