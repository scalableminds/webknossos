// @flow
import type { IsBusyInfo, OxalisState } from "oxalis/store";

export function isBusy(isBusyInfo: IsBusyInfo): boolean {
  return isBusyInfo.skeleton || isBusyInfo.volume;
}

export function selectQueue(
  state: OxalisState,
  tracingType: "skeleton" | "volume",
  tracingId: string,
) {
  if (tracingType === "skeleton") {
    return state.save.queue.skeleton;
  }

  return state.save.queue.volumes[tracingId];
}
