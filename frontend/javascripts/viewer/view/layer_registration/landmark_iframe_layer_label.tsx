import FastTooltip from "components/fast_tooltip";
import { OrthoViews, type Viewport } from "viewer/constants";
import {
  getLandmarkIframeLayerName,
  isLayerRegistrationFixedLandmarkIframe,
  isLayerRegistrationLandmarkIframe,
} from "./layer_registration_protocol";

/** Names the layer of a landmark iframe in the top left corner of its plane viewports, because
 * the views have no title of their own. A long layer name is cut off with "…", and the tooltip
 * shows the full name. The colors don't depend on the theme, because the label lies on the data.
 */
export function LandmarkIframeLayerLabel({ viewportID }: { viewportID: Viewport }) {
  if (!isLayerRegistrationLandmarkIframe() || viewportID === OrthoViews.TDView) {
    return null;
  }
  const layerName = getLandmarkIframeLayerName();
  const role = isLayerRegistrationFixedLandmarkIframe() ? "fixed" : "moving";
  return (
    <FastTooltip
      title={`This view shows the ${role} layer ${layerName}.`}
      wrapper="div"
      className="landmark-iframe-layer-label"
    >
      <span className="landmark-iframe-layer-label-role">{role}</span>
      <span className="landmark-iframe-layer-label-name">{layerName}</span>
    </FastTooltip>
  );
}
