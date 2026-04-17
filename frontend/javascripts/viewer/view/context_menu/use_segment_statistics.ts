import { getSegmentBoundingBoxes, getSegmentSurfaceArea, getSegmentVolumes } from "admin/rest_api";
import { formatNumberToArea, formatNumberToVolume } from "libs/format_utils";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import { LongUnitToShortUnitMap } from "viewer/constants";
import {
  getMagInfo,
  getMaybeSegmentIndexAvailability,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getActiveSegmentationTracing,
  getCurrentMappingName,
} from "viewer/model/accessors/volumetracing_accessor";
import { getBoundingBoxInMag1 } from "viewer/model/sagas/volume/helpers";
import { voxelToVolumeInUnit } from "viewer/model/scaleinfo";
import Store from "viewer/store";

export function useSegmentStatistics(
  clickedSegmentOrMeshId: number,
  segmentStatsTriggerDate: Date | null,
  contextMenuPosition: Readonly<[number, number]> | null | undefined,
  wasSegmentOrMeshClicked: boolean,
) {
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const dataset = useWkSelector((state) => state.dataset);
  const volumeTracing = useWkSelector(getActiveSegmentationTracing);
  const currentMeshFile = useWkSelector((state) =>
    visibleSegmentationLayer != null
      ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
      : null,
  );
  const isSegmentIndexAvailable = getMaybeSegmentIndexAvailability(
    dataset,
    visibleSegmentationLayer?.name,
  );
  const mappingName = useWkSelector(getCurrentMappingName);

  const isLoadingMessage = "loading";
  const isLoadingLabelTuple = [isLoadingMessage, isLoadingMessage, isLoadingMessage] as const;

  const [segmentVolumeLabel, boundingBoxInfoLabel, segmentSurfaceAreaLabel] = useFetch(
    async (): Promise<readonly [string, string, string]> => {
      if (segmentStatsTriggerDate == null) {
        // Should never be rendered because segmentStatsTriggerDate is null.
        return isLoadingLabelTuple;
      }
      const { annotation, flycam } = Store.getState();
      // The value that is returned if the context menu is closed is shown if it's still loading
      if (contextMenuPosition == null || !wasSegmentOrMeshClicked) return isLoadingLabelTuple;
      if (visibleSegmentationLayer == null || !isSegmentIndexAvailable) return isLoadingLabelTuple;

      const tracingId = volumeTracing?.tracingId;
      const additionalCoordinates = flycam.additionalCoordinates;
      const layerSourceInfo = {
        dataset,
        annotation,
        tracingId,
        segmentationLayerName: visibleSegmentationLayer.name,
      };
      const magInfo = getMagInfo(visibleSegmentationLayer.mags);
      const layersFinestMag = magInfo.getFinestMag();
      const voxelSize = dataset.dataSource.scale;

      try {
        const [segmentSize] = await getSegmentVolumes(
          layerSourceInfo,
          layersFinestMag,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
          annotation.version,
        );
        const [boundingBoxInRequestedMag] = await getSegmentBoundingBoxes(
          layerSourceInfo,
          layersFinestMag,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
          annotation.version,
        );
        const [surfaceArea] = await getSegmentSurfaceArea(
          layerSourceInfo,
          layersFinestMag,
          currentMeshFile?.name,
          [clickedSegmentOrMeshId],
          additionalCoordinates,
          mappingName,
          annotation.version,
        );
        const boundingBoxInMag1 = getBoundingBoxInMag1(boundingBoxInRequestedMag, layersFinestMag);
        const boundingBoxTopLeftString = `(${boundingBoxInMag1.topLeft[0]}, ${boundingBoxInMag1.topLeft[1]}, ${boundingBoxInMag1.topLeft[2]})`;
        const boundingBoxSizeString = `(${boundingBoxInMag1.width}, ${boundingBoxInMag1.height}, ${boundingBoxInMag1.depth})`;
        const volumeInUnit3 = voxelToVolumeInUnit(voxelSize, layersFinestMag, segmentSize);

        return [
          formatNumberToVolume(volumeInUnit3, LongUnitToShortUnitMap[voxelSize.unit]),
          `${boundingBoxTopLeftString}, ${boundingBoxSizeString}`,
          formatNumberToArea(surfaceArea, LongUnitToShortUnitMap[voxelSize.unit]),
        ];
      } catch (_error) {
        const notFetchedMessage = "Could not be fetched.";
        return [notFetchedMessage, notFetchedMessage, notFetchedMessage];
      }
    },
    isLoadingLabelTuple,
    // Update segment infos when opening the context menu, in case the annotation was saved since the context menu was last opened.
    // Of course the info should also be updated when the menu is opened for another segment, or after the refresh button was pressed.
    [contextMenuPosition, isSegmentIndexAvailable, clickedSegmentOrMeshId, segmentStatsTriggerDate],
  );

  return {
    segmentVolumeLabel,
    boundingBoxInfoLabel,
    segmentSurfaceAreaLabel,
    isSegmentIndexAvailable,
  };
}
