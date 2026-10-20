import { clamp } from "libs/utils";
import { useLayoutEffect, useRef, useState } from "react";
import type { OrthoView, Rect, Vector2, Vector3 } from "viewer/constants";
import { calculateInViewportPos } from "viewer/model/accessors/view_mode_accessor";
import Dimensions from "viewer/model/dimensions";

export function isPositionStillInPlane(
  positionXYZ: Vector3,
  flycamRotation: Vector3,
  flycamPosition: Vector3,
  planeId: OrthoView,
  baseVoxelFactors: Vector3,
  zoomStep: number,
) {
  if (planeId === "TDView") {
    return false;
  }
  const posInViewport = calculateInViewportPos(
    positionXYZ,
    flycamPosition,
    flycamRotation,
    baseVoxelFactors,
    zoomStep,
  ).toArray();
  const thirdDim = Dimensions.thirdDimensionForPlane(planeId);
  return Math.abs(posInViewport[thirdDim]) < 1;
}

/**
 * Measures the rendered width of the tooltip after every render, because the
 * width depends on the tooltip's content. The width is needed to position the
 * tooltip left of the cursor.
 */
export function useTooltipWidth() {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipWidth, setTooltipWidth] = useState(0);
  useLayoutEffect(() => {
    setTooltipWidth(tooltipRef.current?.offsetWidth ?? 0);
  });
  return [tooltipRef, tooltipWidth] as const;
}

export function getTooltipPosition(
  isNotPinned: boolean,
  tooltipWidth: number,
  viewportRect: Rect,
  tooltipPosition: Vector2,
) {
  const {
    left: viewportLeft,
    top: viewportTop,
    width: viewportWidth,
    height: viewportHeight,
  } = viewportRect;

  // If the tooltip is pinned, there should be no offset
  const OFFSET = isNotPinned ? 8 : 0;

  // Position tooltip just below and to the left of the cursor
  const left = clamp(
    viewportLeft - tooltipWidth + OFFSET, // min
    tooltipPosition[0] - tooltipWidth - OFFSET, // desired position (left of cursor, small offset)
    viewportLeft + viewportWidth - tooltipWidth - OFFSET,
  );
  const top = clamp(
    viewportTop, // min
    tooltipPosition[1] + OFFSET, // just below cursor
    viewportTop + viewportHeight - OFFSET,
  );
  return { left, top };
}
