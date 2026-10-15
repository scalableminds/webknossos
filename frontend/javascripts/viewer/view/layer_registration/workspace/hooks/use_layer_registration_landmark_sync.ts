import { usePolling } from "libs/react_hooks";
import { useEffect, useState } from "react";
import type { Landmark, LayerNames, Side } from "../../helpers/layer_registration_helpers";
import type { SendMessage } from "../layer_registration_iframe_bridge";
import { LandmarkSync, type LandmarkSyncStatus } from "../layer_registration_landmark_sync";

const SYNC_INTERVAL_MS = 500;

/** Runs a LandmarkSync while the workspace is mounted: imports the stored landmarks once all
 * iframes are ready, then syncs every SYNC_INTERVAL_MS.
 * Returns the current landmarks of both workers, the status of the sync, whether changed
 * landmarks still have to be written to the landmark annotation, and the functions of the
 * LandmarkSync that the workspace calls.
 * The workspace is mounted anew for another layer pair, so sendMessage and layerNames don't
 * change while the hook is used.
 */
export function useLandmarkSync(
  sendMessage: SendMessage,
  layerNames: LayerNames,
): {
  landmarks: Record<Side, Landmark[]>;
  status: LandmarkSyncStatus;
  hasUnsyncedLandmarks: boolean;
  fetchLandmarks: () => Promise<Record<Side, Landmark[]>>;
  stopSync: () => void;
  flushAndStopSync: () => Promise<void>;
  resumeSync: () => void;
} {
  const [landmarks, setLandmarks] = useState<Record<Side, Landmark[]>>({ fixed: [], moving: [] });
  const [status, setStatus] = useState<LandmarkSyncStatus>("loading");
  const [hasUnsyncedLandmarks, setHasUnsyncedLandmarks] = useState(false);
  const [isImported, setIsImported] = useState(false);
  const [landmarkSync] = useState(
    () =>
      new LandmarkSync(sendMessage, layerNames, {
        onLandmarksChange: setLandmarks,
        onStatusChange: setStatus,
        onHasUnsyncedLandmarksChange: setHasUnsyncedLandmarks,
      }),
  );

  useEffect(() => {
    let isCancelled = false;
    landmarkSync
      .importStoredLandmarks(() => isCancelled)
      .then((isSuccessful) => {
        if (isSuccessful && !isCancelled) {
          setIsImported(true);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [landmarkSync]);

  // usePolling waits for one run to finish before it schedules the next one, so runs
  // can't overlap.
  usePolling(landmarkSync.sync, isImported ? SYNC_INTERVAL_MS : null, [isImported]);

  return {
    landmarks,
    status,
    hasUnsyncedLandmarks,
    fetchLandmarks: landmarkSync.fetchLandmarks,
    stopSync: landmarkSync.stop,
    flushAndStopSync: landmarkSync.flushAndStop,
    resumeSync: landmarkSync.resume,
  };
}
