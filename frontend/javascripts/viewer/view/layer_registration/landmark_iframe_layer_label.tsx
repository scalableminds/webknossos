import FastTooltip from "components/fast_tooltip";
import { OrthoViews, type Viewport } from "viewer/constants";
import { APPLY_EXPLANATION, ROLE_NAMES, type Side } from "./helpers/layer_registration_helpers";
import {
  getLandmarkIframeLayerName,
  isLayerRegistrationFixedLandmarkIframe,
  isLayerRegistrationLandmarkIframe,
} from "./layer_registration_protocol";

// The names that registration tools like elastix and BigWarp use, for users who know them.
const TECHNICAL_ROLE_NAMES: Record<Side, string> = { fixed: "fixed", moving: "moving" };

/** Names the layer of a landmark iframe in the top left corner of its plane viewports, because
 * the views have no title of their own. A long layer name is cut off with "…", and the tooltip
 * shows the full name and what the role of the layer means. The colors don't depend on the
 * theme, because the label lies on the data.
 */
export function LandmarkIframeLayerLabel({ viewportID }: { viewportID: Viewport }) {
  if (!isLayerRegistrationLandmarkIframe() || viewportID === OrthoViews.TDView) {
    return null;
  }
  const layerName = getLandmarkIframeLayerName();
  const side: Side = isLayerRegistrationFixedLandmarkIframe() ? "fixed" : "moving";
  const role = ROLE_NAMES[side];
  return (
    <FastTooltip
      title={`This view shows the ${role} (${TECHNICAL_ROLE_NAMES[side]}) layer ${layerName}. ${APPLY_EXPLANATION}`}
      wrapper="div"
      className="landmark-iframe-layer-label"
    >
      <span className="landmark-iframe-layer-label-role">{role}</span>
      <span className="landmark-iframe-layer-label-name">{layerName}</span>
    </FastTooltip>
  );
}
