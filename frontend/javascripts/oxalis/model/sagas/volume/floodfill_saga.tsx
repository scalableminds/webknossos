import { message } from "antd";
import { V3 } from "libs/mjs";
import createProgressCallback from "libs/progress_callback";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import type { BoundingBoxType, LabeledVoxelsMap, OrthoView, Vector3 } from "oxalis/constants";
import Constants, { FillModeEnum, Unicode } from "oxalis/constants";

import { getDatasetBoundingBox, getMagInfo } from "oxalis/model/accessors/dataset_accessor";
import { getActiveMagIndexForLayer } from "oxalis/model/accessors/flycam_accessor";
import { enforceActiveVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { addUserBoundingBoxAction } from "oxalis/model/actions/annotation_actions";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import {
  finishAnnotationStrokeAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import Dimensions from "oxalis/model/dimensions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select, take } from "oxalis/model/sagas/effect-generators";
import { requestBucketModificationInVolumeTracing } from "oxalis/model/sagas/saga_helpers";
import { Model } from "oxalis/singletons";
import { call, put } from "typed-redux-saga";
import { getUserBoundingBoxesThatContainPosition } from "../../accessors/tracing_accessor";
import { applyLabeledVoxelMapToAllMissingMags } from "./helpers";
import _ from "lodash";

function* getBoundingBoxForFloodFill(
  position: Vector3,
  currentViewport: OrthoView,
): Saga<BoundingBoxType | { failureReason: string }> {
  const isRestrictedToBoundingBox = yield* select(
    (state) => state.userConfiguration.isFloodfillRestrictedToBoundingBox,
  );
  console.log("########################### isRestrictedToBoundingBox", isRestrictedToBoundingBox);
  if (isRestrictedToBoundingBox) {
    const bboxes = yield* select((state) =>
      getUserBoundingBoxesThatContainPosition(state, position),
    );
    if (bboxes.length > 0) {
      const smallestBbox = _.sortBy(bboxes, (bbox) =>
        new BoundingBox(bbox.boundingBox).getVolume(),
      )[0];
      return smallestBbox.boundingBox;
    } else {
      return {
        failureReason:
          "No bounding box encloses the clicked position. Either disable the bounding box restriction or ensure a bounding box exists around the clicked position.",
      };
    }
  }

  const fillMode = yield* select((state) => state.userConfiguration.fillMode);
  const halfBoundingBoxSizeUVW = V3.scale(Constants.FLOOD_FILL_EXTENTS[fillMode], 0.5);
  const currentViewportBounding = {
    min: V3.sub(position, halfBoundingBoxSizeUVW),
    max: V3.add(position, halfBoundingBoxSizeUVW),
  };

  if (fillMode === FillModeEnum._2D) {
    // Only use current plane
    const thirdDimension = Dimensions.thirdDimensionForPlane(currentViewport);
    const numberOfSlices = 1;
    currentViewportBounding.min[thirdDimension] = position[thirdDimension];
    currentViewportBounding.max[thirdDimension] = position[thirdDimension] + numberOfSlices;
  }

  const datasetBoundingBox = yield* select((state) => getDatasetBoundingBox(state.dataset));
  const { min: clippedMin, max: clippedMax } = new BoundingBox(
    currentViewportBounding,
  ).intersectedWith(datasetBoundingBox);
  return {
    min: clippedMin,
    max: clippedMax,
  };
}

const FLOODFILL_PROGRESS_KEY = "FLOODFILL_PROGRESS_KEY";
export function* floodFill(): Saga<void> {
  yield* take("INITIALIZE_VOLUMETRACING");
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);

  while (allowUpdate) {
    const floodFillAction = yield* take("FLOOD_FILL");

    if (floodFillAction.type !== "FLOOD_FILL") {
      throw new Error("Unexpected action. Satisfy typescript.");
    }

    const { position: positionFloat, planeId } = floodFillAction;
    const volumeTracing = yield* select(enforceActiveVolumeTracing);
    if (volumeTracing.hasEditableMapping) {
      const message = "Volume modification is not allowed when an editable mapping is active.";
      Toast.error(message);
      console.error(message);
      continue;
    }
    const segmentationLayer = yield* call(
      [Model, Model.getSegmentationTracingLayer],
      volumeTracing.tracingId,
    );
    const { cube } = segmentationLayer;
    const seedPosition = Dimensions.roundCoordinate(positionFloat);
    const activeCellId = volumeTracing.activeCellId;
    const dimensionIndices = Dimensions.getIndices(planeId);
    const requestedZoomStep = yield* select((state) =>
      getActiveMagIndexForLayer(state, segmentationLayer.name),
    );
    const magInfo = yield* call(getMagInfo, segmentationLayer.mags);
    const labeledZoomStep = magInfo.getClosestExistingIndex(requestedZoomStep);
    const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
    const oldSegmentIdAtSeed = cube.getDataValue(
      seedPosition,
      additionalCoordinates,
      null,
      labeledZoomStep,
    );

    if (activeCellId === oldSegmentIdAtSeed) {
      Toast.warning("The clicked voxel's id is already equal to the active segment id.");
      continue;
    }

    const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

    if (busyBlockingInfo.isBusy) {
      console.warn(`Ignoring floodfill request (reason: ${busyBlockingInfo.reason || "unknown"})`);
      continue;
    }
    // As the flood fill will be applied to the volume layer,
    // the potentially existing mapping should be locked to ensure a consistent state.
    const isModificationAllowed = yield* call(
      requestBucketModificationInVolumeTracing,
      volumeTracing,
    );
    if (!isModificationAllowed) {
      continue;
    }
    yield* put(setBusyBlockingInfoAction(true, "Floodfill is being computed."));
    const boundingBoxForFloodFill = yield* call(getBoundingBoxForFloodFill, seedPosition, planeId);
    if ("failureReason" in boundingBoxForFloodFill) {
      Toast.warning(boundingBoxForFloodFill.failureReason);
      return;
    }
    const progressCallback = createProgressCallback({
      pauseDelay: 200,
      successMessageDelay: 2000,
      // Since only one floodfill operation can be active at any time,
      // a hardcoded key is sufficient.
      key: FLOODFILL_PROGRESS_KEY,
    });
    yield* call(progressCallback, false, "Performing floodfill...");
    console.time("cube.floodFill");
    const fillMode = yield* select((state) => state.userConfiguration.fillMode);

    const {
      bucketsWithLabeledVoxelsMap: labelMasksByBucketAndW,
      wasBoundingBoxExceeded,
      coveredBoundingBox,
    } = yield* call(
      { context: cube, fn: cube.floodFill },
      seedPosition,
      additionalCoordinates,
      activeCellId,
      dimensionIndices,
      boundingBoxForFloodFill,
      labeledZoomStep,
      progressCallback,
      fillMode === FillModeEnum._3D,
    );
    console.timeEnd("cube.floodFill");
    yield* call(progressCallback, false, "Finalizing floodfill...");
    const indexSet: Set<number> = new Set();

    for (const labelMaskByIndex of labelMasksByBucketAndW.values()) {
      for (const zIndex of labelMaskByIndex.keys()) {
        indexSet.add(zIndex);
      }
    }

    console.time("applyLabeledVoxelMapToAllMissingMags");

    for (const indexZ of indexSet) {
      const labeledVoxelMapFromFloodFill: LabeledVoxelsMap = new Map();

      for (const [bucketAddress, labelMaskByIndex] of labelMasksByBucketAndW.entries()) {
        const map = labelMaskByIndex.get(indexZ);

        if (map != null) {
          labeledVoxelMapFromFloodFill.set(bucketAddress, map);
        }
      }

      applyLabeledVoxelMapToAllMissingMags(
        labeledVoxelMapFromFloodFill,
        labeledZoomStep,
        dimensionIndices,
        magInfo,
        cube,
        activeCellId,
        indexZ,
        true,
      );
    }

    yield* put(finishAnnotationStrokeAction(volumeTracing.tracingId));
    yield* put(
      updateSegmentAction(
        volumeTracing.activeCellId,
        {
          somePosition: seedPosition,
          someAdditionalCoordinates: additionalCoordinates || undefined,
        },
        volumeTracing.tracingId,
      ),
    );

    console.timeEnd("applyLabeledVoxelMapToAllMissingMags");

    if (wasBoundingBoxExceeded) {
      const warningDetails =
        fillMode === FillModeEnum._2D
          ? "Please check the borders of the filled area manually and use the fill tool again if necessary."
          : "A bounding box that represents the labeled volume was added so that you can check the borders manually.";
      yield* call(
        progressCallback,
        true,
        <>
          Floodfill is done, but terminated since the labeled volume got too large. $
          {warningDetails} {Unicode.NonBreakingSpace}
          <a href="#" onClick={() => message.destroy(FLOODFILL_PROGRESS_KEY)}>
            Close
          </a>
        </>,
        {
          successMessageDelay: 10000,
        },
      );
      if (fillMode === FillModeEnum._3D) {
        // The bounding box is overkill for the 2D mode because in that case,
        // it's trivial to check the borders manually.
        yield* put(
          addUserBoundingBoxAction({
            boundingBox: coveredBoundingBox,
            name: `Limits of flood-fill (source_id=${oldSegmentIdAtSeed}, target_id=${activeCellId}, seed=${seedPosition.join(
              ",",
            )}, timestamp=${new Date().getTime()})`,
            color: Utils.getRandomColor(),
            isVisible: true,
          }),
        );
      }
    } else {
      yield* call(progressCallback, true, "Floodfill done.");
    }

    cube.triggerPushQueue();
    yield* put(setBusyBlockingInfoAction(false));

    if (floodFillAction.callback != null) {
      floodFillAction.callback();
    }
  }
}
