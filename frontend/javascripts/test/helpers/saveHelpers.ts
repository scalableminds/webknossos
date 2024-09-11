import type { TracingStats } from "oxalis/model/accessors/annotation_accessor";
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
import type { SaveQueueEntry } from "oxalis/store";
import dummyUser from "test/fixtures/dummy_user";

export function createSaveQueueFromUpdateActions(
  updateActions: UpdateAction[][],
  timestamp: number,
  stats: TracingStats | null = null,
): SaveQueueEntry[] {
  return updateActions.map((ua) => ({
    version: -1,
    timestamp,
    stats,
    actions: ua.slice(),
    info: "[]",
    transactionGroupCount: 1,
    authorId: dummyUser.id,
    transactionGroupIndex: 0,
    transactionId: "dummyRequestId",
  }));
}
export function withoutUpdateTracing(items: Array<UpdateAction>): Array<UpdateAction> {
  return items.filter((item) => item.name !== "updateTracing");
}
export function withoutUpdateTree(items: Array<UpdateAction>): Array<UpdateAction> {
  return items.filter((item) => item.name !== "updateTree");
}
