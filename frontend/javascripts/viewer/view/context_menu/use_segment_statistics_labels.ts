import { formatNumberToArea, formatNumberToVolume } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useEffect, useMemo } from "react";
import { LongUnitToShortUnitMap } from "viewer/constants";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { ensureSegmentIndexIsLoadedAction } from "viewer/model/actions/dataset_actions";
import { getBoundingBoxInMag1 } from "viewer/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "viewer/model/scaleinfo";
import Store from "viewer/store";
import {
  type SegmentStatistic,
  useSegmentStatistics,
} from "viewer/view/right_border_tabs/segments_tab/hooks/use_segment_statistics";

const LOADING_MESSAGE = "loading";
const NOT_FETCHED_MESSAGE = "Could not be fetched.";

function formatStatistic<T>(statistic: SegmentStatistic<T>, format: (value: T) => string): string {
  if (statistic.isError) {
    return NOT_FETCHED_MESSAGE;
  }
  const value = statistic.data?.[0];
  return value === undefined ? LOADING_MESSAGE : format(value);
}

/*
 * Formats the subset of segment statistics that the viewport context menu shows for the clicked
 * segment. The statistics themselves come from the same hook the segment statistics table uses, so
 * both agree on the requested mag and on which layers can answer at all; this menu simply displays
 * fewer of them.
 *
 * Nothing is requested until the user explicitly asks for the statistics, which is what
 * `segmentStatsTriggerDate` tracks.
 */
export function useSegmentStatisticsLabels(
  clickedSegmentOrMeshId: bigint,
  segmentStatsTriggerDate: Date | null,
  contextMenuPosition: Readonly<[number, number]> | null | undefined,
  wasSegmentOrMeshClicked: boolean,
) {
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  const shortUnit = LongUnitToShortUnitMap[voxelSize.unit];

  useEffect(() => {
    if (wasSegmentOrMeshClicked) {
      Store.dispatch(ensureSegmentIndexIsLoadedAction(visibleSegmentationLayer?.name));
    }
  }, [wasSegmentOrMeshClicked, visibleSegmentationLayer?.name]);

  const segmentIds = useMemo(() => [clickedSegmentOrMeshId], [clickedSegmentOrMeshId]);

  const {
    areSegmentStatisticsAvailable,
    isBoundingBoxAvailable,
    isVolumeAvailable,
    isSurfaceAreaAvailable,
    statisticsMag,
    boundingBoxMag,
    volumes,
    boundingBoxes,
    surfaceAreas,
  } = useSegmentStatistics({
    layer: visibleSegmentationLayer,
    segmentIds,
    enabled:
      wasSegmentOrMeshClicked && contextMenuPosition != null && segmentStatsTriggerDate != null,
    // Reopening the context menu or pressing refresh must re-read the statistics, in case the
    // annotation changed in the meantime.
    refreshToken: segmentStatsTriggerDate?.getTime() ?? null,
  });

  const segmentVolumeLabel = formatStatistic(volumes, (volumeInVoxel) =>
    formatNumberToVolume(voxelToVolumeInUnit(voxelSize, statisticsMag, volumeInVoxel), shortUnit),
  );

  const segmentSurfaceAreaLabel = formatStatistic(surfaceAreas, (surfaceArea) =>
    formatNumberToArea(surfaceArea, shortUnit),
  );

  const boundingBoxInfoLabel = formatStatistic(boundingBoxes, (boundingBox) => {
    const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBox, boundingBoxMag);
    const topLeft = `(${boundingBoxInMag1.topLeft.join(", ")})`;
    const size = `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`;
    return `${topLeft}, ${size}`;
  });

  return {
    segmentVolumeLabel,
    boundingBoxInfoLabel,
    segmentSurfaceAreaLabel,
    areSegmentStatisticsAvailable,
    isBoundingBoxAvailable,
    isVolumeAvailable,
    isSurfaceAreaAvailable,
  };
}
