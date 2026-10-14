import { Button, Flex, Result, Spin, Typography } from "antd";
import type { APIDataset } from "types/api_types";
import {
  getLandmarkColor,
  getLandmarkTreeName,
  type LayerNames,
  SIDES,
  type Side,
} from "../helpers/layer_registration_helpers";
import {
  getLayerRegistrationStoreUrl,
  getLayerRegistrationWorkerUrl,
} from "../layer_registration_protocol";
import { LandmarkColorDot } from "../panel/layer_registration_pair_table";
import type { IframeRefs, IframeRole } from "./hooks/use_layer_registration_iframe_bridge";
import type { LandmarkSyncStatus } from "./hooks/use_layer_registration_landmark_sync";

// Why the workers are covered, see WorkspaceOverlay.
type OverlayStatus = Exclude<LandmarkSyncStatus, "ready"> | "restarting" | "switching";

export function getOverlayStatus(
  syncStatus: LandmarkSyncStatus,
  isRestarting: boolean,
  isSwitching: boolean,
): OverlayStatus | null {
  if (isRestarting) {
    return "restarting";
  }
  if (isSwitching) {
    return "switching";
  }
  return syncStatus !== "ready" ? syncStatus : null;
}

const OVERLAY_TEXTS: Record<Exclude<OverlayStatus, "failed">, string> = {
  loading: "Loading the landmarks…",
  restarting: "Restarting the layer registration view…",
  switching: "Saving the landmarks…",
};

// The element that has the keyboard focus, also if it is inside one of the iframes.
function getFocusedElement(): Element | null {
  let element = document.activeElement;
  while (element instanceof HTMLIFrameElement && element.contentDocument != null) {
    element = element.contentDocument.activeElement;
  }
  return element;
}

function isTextInputFocused(): boolean {
  const element = getFocusedElement();
  return (
    element != null &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
      // Not checked with instanceof: an element inside an iframe belongs to the iframe's window,
      // so it is no instance of this window's HTMLElement.
      (element as HTMLElement).isContentEditable)
  );
}

// Shown in a view that misses landmarks of the other view, so that the user sees which pair
// the next click completes (see getNextLandmarkPairId).
function NextLandmarkHint({ openPairIds }: { openPairIds: number[] }) {
  if (openPairIds.length === 0) {
    return null;
  }
  const [nextPairId] = openPairIds;
  return (
    <div className="layer-registration-next-landmark-hint">
      <LandmarkColorDot color={getLandmarkColor(nextPairId)} />
      {getLandmarkTreeName(nextPairId)}: click the matching spot in this view.
      {openPairIds.length > 1
        ? ` ${openPairIds.length} landmarks still need a partner here.`
        : null}
    </div>
  );
}

// Covers the workers until the stored landmarks were imported, while restarting and while
// switching to another moving layer. A landmark placed before the import could get the pair
// id of a stored landmark.
function WorkspaceOverlay({
  status,
  switchTargetLayerName,
}: {
  status: OverlayStatus;
  switchTargetLayerName: string | null;
}) {
  return (
    <Flex className="layer-registration-overlay" vertical justify="center" align="center" gap={8}>
      {status !== "failed" ? (
        <>
          <Spin size="large" />
          <Typography.Text>
            {status === "switching" && switchTargetLayerName != null
              ? `Switching to ${switchTargetLayerName}…`
              : OVERLAY_TEXTS[status]}
          </Typography.Text>
        </>
      ) : (
        <Result
          status="error"
          title="Could not load the stored landmarks"
          subTitle="New landmarks can't be saved. Reload the page to try again."
          extra={
            <Button type="primary" onClick={() => location.reload()}>
              Reload
            </Button>
          }
        />
      )}
    </Flex>
  );
}

/** The two workers side by side and the hidden store iframe (see
 * use_layer_registration_iframe_bridge.ts). An overlay covers the workers while they are not
 * ready for new landmarks.
 */
export function LayerRegistrationWorkerFrames({
  dataset,
  layerNames,
  landmarkAnnotationId,
  iframesRef,
  onIframeLoad,
  openPairIds,
  overlayStatus,
  switchTargetLayerName,
}: {
  dataset: APIDataset;
  layerNames: LayerNames;
  landmarkAnnotationId: string;
  iframesRef: IframeRefs;
  onIframeLoad: (role: IframeRole) => void;
  // Per view, the pair ids whose landmark is missing in that view, see getLandmarkPairInfo.
  openPairIds: Record<Side, number[]>;
  overlayStatus: OverlayStatus | null;
  // The moving layer that is shown next while overlayStatus is "switching".
  switchTargetLayerName: string | null;
}) {
  // The shortcuts go to the view that has the keyboard focus. Clicking into a view to focus
  // it would place a landmark, so a view gets the focus when the mouse enters it instead.
  const focusWorker = (side: Side) => {
    if (!isTextInputFocused()) {
      iframesRef.current[side]?.contentWindow?.focus();
    }
  };

  return (
    <Flex style={{ height: "100%", position: "relative" }}>
      {SIDES.map((side) => (
        <div key={side} className="layer-registration-worker">
          <iframe
            ref={(element) => {
              iframesRef.current[side] = element;
            }}
            title={`${side === "fixed" ? "Fixed" : "Moving"} layer (${layerNames[side]})`}
            src={getLayerRegistrationWorkerUrl(dataset, layerNames[side], side === "fixed")}
            onLoad={() => onIframeLoad(side)}
            onMouseEnter={() => focusWorker(side)}
          />
          <NextLandmarkHint openPairIds={openPairIds[side]} />
        </div>
      ))}
      <iframe
        ref={(element) => {
          iframesRef.current.store = element;
        }}
        title="Layer registration annotation"
        style={{ display: "none" }}
        src={getLayerRegistrationStoreUrl(landmarkAnnotationId)}
        onLoad={() => onIframeLoad("store")}
      />
      {overlayStatus != null ? (
        <WorkspaceOverlay status={overlayStatus} switchTargetLayerName={switchTargetLayerName} />
      ) : null}
    </Flex>
  );
}
