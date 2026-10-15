import isEqual from "lodash-es/isEqual";
import type { Vector3 } from "viewer/constants";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import {
  getLandmarkGroupPath,
  getLandmarkPairInfo,
  getLandmarks,
  type Landmark,
  type LandmarkPairInfo,
  type LayerNames,
  SIDES,
  type Side,
} from "../helpers/layer_registration_helpers";
import type { SendMessage } from "./layer_registration_iframe_bridge";

// What is compared to decide whether a side must be written to the landmark annotation. Tree
// ids change on every import and colors follow the pair ids, so both are left out.
function getStoredFields(
  landmarks: Landmark[],
): Array<{ pairId: number | null; position: Vector3 }> {
  return landmarks.map(({ pairId, position }) => ({ pairId, position }));
}

// The landmarks of one worker, as NML and parsed.
type WorkerLandmarks = { nmlString: string; landmarks: Landmark[] };

function getParsedLandmarks(
  workerLandmarks: Record<Side, WorkerLandmarks>,
): Record<Side, Landmark[]> {
  return { fixed: workerLandmarks.fixed.landmarks, moving: workerLandmarks.moving.landmarks };
}

// "loading" until the stored landmarks were imported into the workers and the landmarks of
// the workers were read once. "failed" if the import failed. Then nothing is synced, because
// the workers would overwrite the stored landmarks with their incomplete ones.
export type LandmarkSyncStatus = "loading" | "ready" | "failed";

// Called whenever the respective value changes.
export type LandmarkSyncListener = {
  onLandmarksChange: (landmarks: Record<Side, Landmark[]>) => void;
  onStatusChange: (status: LandmarkSyncStatus) => void;
  // Whether changed landmarks of the workers still have to be written to the landmark
  // annotation.
  onHasUnsyncedLandmarksChange: (hasUnsyncedLandmarks: boolean) => void;
};

/** Keeps the landmarks of the two workers and the persisted landmark annotation in sync:
 * 1. importStoredLandmarks imports the stored landmarks of each side into the worker of that
 *    side. The worker annotations are sandboxes and start empty.
 * 2. Afterwards, each worker is the source of truth for its side. Each call of sync reads the
 *    landmarks of both workers. When the landmarks of a worker changed (added, deleted,
 *    moved, undo, ...), the group of that side in the landmark annotation is replaced with
 *    the trees of the worker. Each worker also gets the pair info that it needs to name its
 *    next landmark (see getLandmarkPairInfo).
 * The sync can be stopped for good (e.g. after a worker lost its landmarks), or stopped after
 * writing the last changes and resumed (e.g. before and after a failed switch to another
 * moving layer).
 */
export class LandmarkSync {
  // The ids of the tree groups that hold the landmarks of each side in the landmark
  // annotation. Null until the stored landmarks were imported into the workers.
  private groupIds: Record<Side, number> | null = null;
  // The landmarks of each side as they were last written to the landmark annotation.
  private storedFields: Record<Side, ReturnType<typeof getStoredFields>> = {
    fixed: [],
    moving: [],
  };
  // The pair info that was last sent to each worker.
  private sentPairInfo: Partial<Record<Side, LandmarkPairInfo>> = {};
  private landmarks: Record<Side, Landmark[]> = { fixed: [], moving: [] };
  // Set when a worker was reloaded. Its landmarks are then missing until the stored ones are
  // imported again, so writing them to the landmark annotation would delete landmarks. Also
  // set while switching to another moving layer.
  private isStopped = false;
  // The sync run that is in progress, if any.
  private runningSync: Promise<void> | null = null;

  constructor(
    private readonly sendMessage: SendMessage,
    private readonly layerNames: LayerNames,
    private readonly listener: LandmarkSyncListener,
  ) {}

  private async importStoredLandmarksOfSide(
    side: Side,
    isCancelled: () => boolean,
  ): Promise<number> {
    const groupId = await this.sendMessage(
      "store",
      "ensureTreeGroupPath",
      getLandmarkGroupPath(this.layerNames, side),
    );
    const nmlString = await this.sendMessage("store", "exportTreesAsNmlString", { groupId });
    if (isCancelled()) {
      return groupId;
    }
    await this.sendMessage(side, "importLandmarks", nmlString);
    this.storedFields[side] = getStoredFields(getLandmarks((await parseNml(nmlString)).trees));
    return groupId;
  }

  // Resolves with whether the import succeeded. isCancelled stops the import before anything
  // is imported into a worker.
  async importStoredLandmarks(isCancelled: () => boolean = () => false): Promise<boolean> {
    try {
      const fixedGroupId = await this.importStoredLandmarksOfSide("fixed", isCancelled);
      const movingGroupId = await this.importStoredLandmarksOfSide("moving", isCancelled);
      if (isCancelled()) {
        return false;
      }
      this.groupIds = { fixed: fixedGroupId, moving: movingGroupId };
      return true;
    } catch (error) {
      console.error("Could not load the stored landmarks:", error);
      if (!isCancelled()) {
        this.listener.onStatusChange("failed");
      }
      return false;
    }
  }

  private async fetchLandmarksOfWorker(side: Side): Promise<WorkerLandmarks> {
    const nmlString = await this.sendMessage(side, "exportTreesAsNmlString");
    return { nmlString, landmarks: getLandmarks((await parseNml(nmlString)).trees) };
  }

  // Reads the landmarks of both workers and reports them if they changed.
  private async fetchWorkerLandmarks(): Promise<Record<Side, WorkerLandmarks>> {
    const [fixed, moving] = await Promise.all(
      SIDES.map((side) => this.fetchLandmarksOfWorker(side)),
    );
    const workerLandmarks = { fixed, moving };
    const newLandmarks = getParsedLandmarks(workerLandmarks);
    if (!isEqual(this.landmarks, newLandmarks)) {
      this.landmarks = newLandmarks;
      this.listener.onLandmarksChange(newLandmarks);
    }
    return workerLandmarks;
  }

  private hasUnstoredChanges(side: Side, landmarksOfSide: Landmark[]): boolean {
    return !isEqual(getStoredFields(landmarksOfSide), this.storedFields[side]);
  }

  // Replaces the stored landmarks of each side whose landmarks changed in its worker.
  private async storeChangedLandmarks(
    workerLandmarks: Record<Side, WorkerLandmarks>,
    groupIds: Record<Side, number>,
  ) {
    for (const side of SIDES) {
      const { nmlString, landmarks: landmarksOfSide } = workerLandmarks[side];
      if (this.hasUnstoredChanges(side, landmarksOfSide)) {
        await this.sendMessage("store", "replaceTreesInGroup", nmlString, groupIds[side]);
        this.storedFields[side] = getStoredFields(landmarksOfSide);
      }
    }
    this.listener.onHasUnsyncedLandmarksChange(false);
  }

  private async sendChangedPairInfo(side: Side, newLandmarks: Record<Side, Landmark[]>) {
    const pairInfo = getLandmarkPairInfo(newLandmarks, side);
    if (isEqual(pairInfo, this.sentPairInfo[side])) {
      return;
    }
    await this.sendMessage(side, "setLandmarkPairInfo", pairInfo);
    this.sentPairInfo[side] = pairInfo;
  }

  private async syncImportedLandmarks(groupIds: Record<Side, number>) {
    try {
      const workerLandmarks = await this.fetchWorkerLandmarks();
      const newLandmarks = getParsedLandmarks(workerLandmarks);
      // Sent before the overlay goes away, so that the first click already uses it.
      await Promise.all(SIDES.map((side) => this.sendChangedPairInfo(side, newLandmarks)));
      this.listener.onStatusChange("ready");
      this.listener.onHasUnsyncedLandmarksChange(
        SIDES.some((side) => this.hasUnstoredChanges(side, newLandmarks[side])),
      );
      if (!this.isStopped) {
        await this.storeChangedLandmarks(workerLandmarks, groupIds);
      }
    } catch (error) {
      console.error("Could not sync the landmarks:", error);
    }
  }

  // One sync run. Does nothing before the stored landmarks were imported and while the sync
  // is stopped. The caller must not start a run before the previous one finished.
  sync = async () => {
    if (this.groupIds == null || this.isStopped) {
      return;
    }
    this.runningSync = this.syncImportedLandmarks(this.groupIds);
    await this.runningSync;
  };

  fetchLandmarks = async (): Promise<Record<Side, Landmark[]>> =>
    getParsedLandmarks(await this.fetchWorkerLandmarks());

  stop = () => {
    this.isStopped = true;
  };

  // Writes the current landmarks of both workers to the landmark annotation, so that a
  // landmark placed right before is not lost, and stops the sync. Throws if writing fails.
  flushAndStop = async () => {
    this.isStopped = true;
    await this.runningSync;
    if (this.groupIds == null) {
      // The stored landmarks were not imported yet, so the workers have nothing new.
      return;
    }
    await this.storeChangedLandmarks(await this.fetchWorkerLandmarks(), this.groupIds);
  };

  resume = () => {
    this.isStopped = false;
  };
}
