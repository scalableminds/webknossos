import { message } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { VoxelyticsRunState } from "types/api_types";

export const VX_POLLING_INTERVAL = null; // disabled for now. 30 * 1000; // 30s
const LOG_TIME_PADDING = 60 * 1000; // 1 minute

export type Result<T> =
  | {
      type: "SUCCESS";
      value: T;
    }
  | { type: "ERROR" }
  | { type: "LOADING" };

export function runStateToStatus(state: VoxelyticsRunState) {
  switch (state) {
    case VoxelyticsRunState.COMPLETE:
      return "success";
    case VoxelyticsRunState.STALE:
    case VoxelyticsRunState.FAILED:
    case VoxelyticsRunState.CANCELLED:
      return "exception";
    case VoxelyticsRunState.PENDING:
      return "active";
    default:
      return "normal";
  }
}

// https://github.com/reduxjs/redux-devtools/blob/75322b15ee7ba03fddf10ac3399881e302848874/src/react/themes/default.js
const theme = {
  scheme: "default",
  author: "chris kempson (http://chriskempson.com)",
  base00: "transparent",
  base01: "#282828",
  base02: "#383838",
  base03: "#585858",
  base04: "#b8b8b8",
  base05: "#d8d8d8",
  base06: "#e8e8e8",
  base07: "#f8f8f8",
  base08: "#ab4642",
  base09: "#dc9656",
  base0A: "#f7ca88",
  base0B: "#a1b56c",
  base0C: "#86c1b9",
  base0D: "#7cafc2",
  base0E: "#ba8baf",
  base0F: "#a16946",
};

export function useTheme(): [typeof theme, boolean] {
  const selectedTheme = useWkSelector((state) => state.uiInformation.theme);
  return [theme, selectedTheme === "light"];
}

export function isObjectEmpty(obj: Record<string, any>) {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
}

export async function copyToClipboad(text: string) {
  await navigator.clipboard.writeText(text);
  message.success("Copied to clipboard");
}

export function addBeforePadding(date: Date): Date {
  return new Date(date.getTime() - LOG_TIME_PADDING);
}

export function addAfterPadding(date: Date): Date {
  return new Date(date.getTime() + LOG_TIME_PADDING);
}
