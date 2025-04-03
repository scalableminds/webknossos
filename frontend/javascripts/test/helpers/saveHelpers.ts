import type { TracingStats } from "oxalis/model/accessors/annotation_accessor";
import type { UpdateActionWithoutIsolationRequirement } from "oxalis/model/sagas/update_actions";
import type { SaveQueueEntry } from "oxalis/store";
import dummyUser from "test/fixtures/dummy_user";

export function createSaveQueueFromUpdateActions(
  updateActions: UpdateActionWithoutIsolationRequirement[][],
  timestamp: number,
  stats: TracingStats | null = null,
): SaveQueueEntry[] {
  
  return updateActions.map((ua) => ({
    version: -1,
    timestamp,
    stats,
    actions: ua,
    info: "[]",
    transactionGroupCount: 1,
    authorId: dummyUser.id,
    transactionGroupIndex: 0,
    transactionId: "dummyRequestId",
  }));
}

export function withoutUpdateTracing(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter(
    (item) => item.name !== "updateSkeletonTracing" && item.name !== "updateVolumeTracing",
  );
}

export function withoutUpdateTree(
  items: UpdateActionWithoutIsolationRequirement[],
): UpdateActionWithoutIsolationRequirement[] {
  return items.filter((item) => item.name !== "updateTree");
}
