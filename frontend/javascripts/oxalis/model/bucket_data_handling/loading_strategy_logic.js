// @flow

import type { LoadingStrategy } from "oxalis/store";

const MAX_ZOOM_STEP_DIFF_QUALITY_FIRST = 1;
const MAX_ZOOM_STEP_DIFF_PROGRESSIVE_QUALITY = 3;

const zoomStepMultiplier = 1000;

export function getMaxZoomStepDiff(strategy: LoadingStrategy): number {
  if (strategy === "BEST_QUALITY_FIRST") {
    return MAX_ZOOM_STEP_DIFF_QUALITY_FIRST;
  } else {
    return MAX_ZOOM_STEP_DIFF_PROGRESSIVE_QUALITY;
  }
}

export function getPriorityWeightForZoomStepDiff(
  strategy: LoadingStrategy,
  zoomStepDiff: number,
): number {
  // Low numbers equal high priority
  if (strategy === "BEST_QUALITY_FIRST") {
    return zoomStepDiff * zoomStepMultiplier;
  } else {
    return (MAX_ZOOM_STEP_DIFF_PROGRESSIVE_QUALITY - zoomStepDiff) * zoomStepMultiplier;
  }
}

export function getPriorityWeightForPrefetch(): number {
  const maxMaxZoomStepDiff = Math.max(
    MAX_ZOOM_STEP_DIFF_PROGRESSIVE_QUALITY,
    MAX_ZOOM_STEP_DIFF_QUALITY_FIRST,
  );
  // Always schedule prefetch requests after the bucket picker priorities
  return (maxMaxZoomStepDiff + 1) * zoomStepMultiplier;
}
