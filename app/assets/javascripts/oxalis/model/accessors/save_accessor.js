// @flow
import type { IsBusyInfoType } from "oxalis/store";

export function isBusy(isBusyInfo: IsBusyInfoType): boolean {
  return isBusyInfo.skeleton || isBusyInfo.volume;
}

export default {};
