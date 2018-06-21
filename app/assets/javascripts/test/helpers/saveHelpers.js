import type { UpdateAction } from "oxalis/model/sagas/update_actions";

export function createSaveQueueFromUpdateActions(updateActions, timestamp, stats = null) {
  return updateActions.map(ua => ({
    version: -1,
    timestamp,
    stats,
    actions: [].concat(ua),
  }));
}

export function withoutUpdateTracing(items: Array<UpdateAction>): Array<UpdateAction> {
  return items.filter(item => item.name !== "updateTracing");
}
