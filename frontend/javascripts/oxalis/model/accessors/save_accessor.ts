import * as Utils from "libs/utils";
import type { SaveQueueType } from "oxalis/model/actions/save_actions";
import type { IsBusyInfo, OxalisState, SaveQueueEntry } from "oxalis/store";

export function isBusy(isBusyInfo: IsBusyInfo): boolean {
  return (
    isBusyInfo.skeleton ||
    Utils.values(isBusyInfo.volumes).some((el) => el) ||
    Utils.values(isBusyInfo.mappings).some((el) => el)
  );
}
export function selectQueue(
  state: OxalisState,
  saveQueueType: SaveQueueType,
  tracingId: string,
): Array<SaveQueueEntry> {
  switch (saveQueueType) {
    case "skeleton":
      return state.save.queue.skeleton;
    case "volume":
      return state.save.queue.volumes[tracingId];
    case "mapping":
      return state.save.queue.mappings[tracingId];
    default:
      throw new Error(`Unknown save queue type: ${saveQueueType}`);
  }
}
