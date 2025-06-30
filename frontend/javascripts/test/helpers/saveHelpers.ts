import type { TracingStats } from "viewer/model/accessors/annotation_accessor";
import type { UpdateActionWithoutIsolationRequirement } from "viewer/model/sagas/update_actions";
import type { SaveQueueEntry } from "viewer/store";
import { idUserA } from "test/e2e-setup";
import dummyUser from "test/fixtures/dummy_user";

export function createSaveQueueFromUpdateActions(
  updateActions: UpdateActionWithoutIsolationRequirement[][],
  timestamp: number,
  stats: TracingStats | null = null,
  useE2eAuthorId: boolean = false,
): SaveQueueEntry[] {
  return updateActions.map((ua) => ({
    version: -1,
    timestamp,
    stats,
    actions: ua,
    info: "[]",
    transactionGroupCount: 1,
    authorId: useE2eAuthorId ? idUserA : dummyUser.id,
    transactionGroupIndex: 0,
    transactionId: "dummyRequestId",
  }));
}

export function withoutUpdateTracing(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter(
    (item) =>
      item.name !== "updateSkeletonTracing" &&
      item.name !== "updateVolumeTracing" &&
      item.name !== "updateActiveNode" &&
      item.name !== "updateActiveSegmentId",
  );
}

export function withoutUpdateTree(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter((item) => item.name !== "updateTree");
}

export function withoutUpdateSegment(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter((item) => item.name !== "updateSegment");
}
