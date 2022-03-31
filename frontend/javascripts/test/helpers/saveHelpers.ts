// @noflow
import type { UpdateAction } from "oxalis/model/sagas/update_actions";
// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'updateActions' implicitly has an 'any' ... Remove this comment to see the full error message
export function createSaveQueueFromUpdateActions(updateActions, timestamp, stats = null) {
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'ua' implicitly has an 'any' type.
  return updateActions.map((ua) => ({
    version: -1,
    timestamp,
    stats,
    actions: [].concat(ua),
    info: "[]",
    transactionGroupCount: 1,
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
