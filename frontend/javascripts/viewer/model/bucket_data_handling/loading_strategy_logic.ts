import type { LoadingStrategy } from "viewer/store";

export const MAX_ZOOM_STEP_DIFF = 3;
const zoomStepMultiplier = 1000;

export function getPriorityWeightForZoomStepDiff(
  strategy: LoadingStrategy,
  zoomStepDiff: number,
): number {
  // Low numbers designate high priority
  if (strategy === "BEST_QUALITY_FIRST") {
    return zoomStepDiff * zoomStepMultiplier;
  } else {
    return (MAX_ZOOM_STEP_DIFF - zoomStepDiff) * zoomStepMultiplier;
  }
}
export function getPriorityWeightForPrefetch(): number {
  // Always schedule prefetch requests after the bucket picker priorities
  return (MAX_ZOOM_STEP_DIFF + 1) * zoomStepMultiplier;
}
