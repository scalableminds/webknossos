import type { IsBusyInfo, OxalisState, SaveQueueEntry } from "oxalis/store";
import type { SaveQueueType } from "oxalis/model/actions/save_actions";
import * as Utils from "libs/utils";

export function isBusy(isBusyInfo: IsBusyInfo): boolean {
  return (
    isBusyInfo.skeleton ||
    Utils.values(isBusyInfo.volumes).some((el) => el) ||
    Utils.values(isBusyInfo.mappings).some((el) => el)
  );
}
