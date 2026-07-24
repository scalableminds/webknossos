import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { getVisibleSegments } from "viewer/model/accessors/volumetracing_accessor";
import { buildSegmentHierarchy, type SegmentsHierarchy } from "../hierarchy";

/*
 * Derives the antd-consumable segment hierarchy (plus all key sets derived from it)
 * for the visible segmentation layer from the Redux store in a single memoized pass.
 */
export function useSegmentHierarchy(): SegmentsHierarchy {
  const segments = useWkSelector((state) => getVisibleSegments(state).segments);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);

  return useMemo(() => buildSegmentHierarchy(segments, segmentGroups), [segments, segmentGroups]);
}
