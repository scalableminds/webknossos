// @flow
import type { IsBusyInfo } from "oxalis/store";

export function isBusy(isBusyInfo: IsBusyInfo): boolean {
  return isBusyInfo.skeleton || isBusyInfo.volume;
}

export default {};
