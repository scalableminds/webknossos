import { V2, V3 } from "libs/mjs";
import createProgressCallback, { type ProgressCallback } from "libs/progress_callback";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import { call, put, takeEvery } from "typed-redux-saga";
import type {
  BoundingBoxType,
  FillMode,
  LabeledVoxelsMap,
  OrthoView,
  Vector2,
  Vector3,
} from "viewer/constants";
import Constants, { FillModeEnum, Unicode } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getDatasetBoundingBox, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { getDisabledInfoForTools } from "viewer/model/accessors/disabled_tool_accessor";
import { getActiveMagIndexForLayer } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool, Toolkit } from "viewer/model/accessors/tool_accessor";
import { enforceActiveVolumeTracing } from "viewer/model/accessors/volumetracing_accessor";
import { addUserBoundingBoxAction } from "viewer/model/actions/annotation_actions";
import { setBusyBlockingInfoAction } from "viewer/model/actions/ui_actions";
import {
  type FloodFillAction,
  finishAnnotationStrokeAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import Dimensions from "viewer/model/dimensions";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { requestBucketModificationInVolumeTracing } from "viewer/model/sagas/saga_helpers";
import { Model } from "viewer/singletons";
import { getUserBoundingBoxesThatContainPosition } from "../../accessors/tracing_accessor";
import { applyLabeledVoxelMapToAllMissingMags } from "./helpers";

const NO_FLOODFILL_BBOX_TOAST_KEY = "NO_FLOODFILL_BBOX";
const NO_SUCCESS_MSG_WHEN_WITHIN_MS = 500;

export function* floodFill(): Saga<void> {
  yield* takeEvery("FLOOD_FILL", handleFloodFill);
}

function getMaximumBoundingBoxSizeForFloodfill(
  fillMode: FillMode,
  finestSegmentationLayerMag: Vector3,
): Vector3 {
  const maximumBoundingBoxMag1 = Constants.FLOOD_FILL_EXTENTS[fillMode];
  // If the finest mag of the segmentation layer is not Mag(1), the maximum bounding box needs to be scaled accordingly
  const maximumBoundingBoxInFinestMag = V3.scale3(
    maximumBoundingBoxMag1,
    finestSegmentationLayerMag,
  );
  return maximumBoundingBoxInFinestMag;
}

function* getBoundingBoxForFloodFillWhenRestricted(
  position: Vector3,
  currentViewport: OrthoView,
  finestSegmentationLayerMag: Vector3,
) {
  const fillMode = yield* select((state) => state.userConfiguration.fillMode);
  const bboxes = yield* select((state) => getUserBoundingBoxesThatContainPosition(state, position));
  if (bboxes.length === 0) {
    return {
      failureReason:
        "No bounding box encloses the clicked position. Either disable the bounding box restriction or ensure a bounding box exists around the clicked position.",
    };
  }
  const smallestBbox = _.sortBy(bboxes, (bbox) => new BoundingBox(bbox.boundingBox).getVolume())[0];

  const maxBboxSize = yield* call(
    getMaximumBoundingBoxSizeForFloodfill,
    fillMode,
    finestSegmentationLayerMag,
  );
  const maxBboxVolume = Constants.FLOOD_FILL_MULTIPLIER_FOR_BBOX_RESTRICTION * V3.prod(maxBboxSize);
  const bboxObj = new BoundingBox(smallestBbox.boundingBox);

  const bboxVolume =
    fillMode === FillModeEnum._3D
      ? bboxObj.getVolume()
      : // Only consider the 2D projection of the bounding box onto the current viewport
        V2.prod(
          Dimensions.getIndices(currentViewport).map((idx) => bboxObj.getSize()[idx]) as Vector2,
        );
  if (bboxVolume > maxBboxVolume) {
    return {
      failureReason: `The bounding box that encloses the clicked position is too large, containing ${bboxVolume} voxels. Shrink its size so that it does not contain more than ${maxBboxVolume} voxels.`,
    };
  }
  return smallestBbox.boundingBox;
}

function* getBoundingBoxForFloodFillWhenUnrestricted(
  position: Vector3,
  currentViewport: OrthoView,
  finestSegmentationLayerMag: Vector3,
) {
  const fillMode = yield* select((state) => state.userConfiguration.fillMode);
  const maxBoundingBoxSize = yield* call(
    getMaximumBoundingBoxSizeForFloodfill,
    fillMode,
    finestSegmentationLayerMag,
  );
  const halfBoundingBoxSize = V3.scale(maxBoundingBoxSize, 0.5);
  const currentViewportBounding = {
    min: V3.sub(position, halfBoundingBoxSize),
    max: V3.add(position, halfBoundingBoxSize),
  };

  if (fillMode === FillModeEnum._2D) {
    // Only use current plane
    const thirdDimension = Dimensions.thirdDimensionForPlane(currentViewport);
    const numberOfSlices = finestSegmentationLayerMag[thirdDimension];
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

function* getBoundingBoxForFloodFill(
  position: Vector3,
  currentViewport: OrthoView,
  finestSegmentationLayerMag: Vector3,
): Saga<BoundingBoxType | { failureReason: string }> {
  const isRestrictedToBoundingBox = yield* select(
    (state) => state.userConfiguration.isFloodfillRestrictedToBoundingBox,
  );
  if (isRestrictedToBoundingBox) {
    return yield* call(
      getBoundingBoxForFloodFillWhenRestricted,
      position,
      currentViewport,
      finestSegmentationLayerMag,
    );
  } else {
    return yield* call(
      getBoundingBoxForFloodFillWhenUnrestricted,
      position,
      currentViewport,
      finestSegmentationLayerMag,
    );
  }
}

function* handleFloodFill(floodFillAction: FloodFillAction): Saga<void> {
  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  const disabledInfosForTools = yield* select(getDisabledInfoForTools);

  if (!allowUpdate || disabledInfosForTools[AnnotationTool.FILL_CELL.id].isDisabled) {
    return;
  }

  const { position: positionFloat, planeId } = floodFillAction;
  const volumeTracing = yield* select(enforceActiveVolumeTracing);
  if (volumeTracing.hasEditableMapping) {
    const message = "Volume modification is not allowed when an editable mapping is active.";
    Toast.error(message);
    console.error(message);
    return;
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
    return;
  }

  const sceneController = getSceneController();
  const isSplitToolkit = yield* select(
    (state) => state.userConfiguration.activeToolkit === Toolkit.SPLIT_SEGMENTS,
  );
  const splitBoundaryMesh = isSplitToolkit ? sceneController.getSplitBoundaryMesh() : null;

  if (isSplitToolkit) {
    if (!splitBoundaryMesh) {
      Toast.warning(
        `No split boundary found. Ensure that the active tree has at least two nodes. If you want to execute a normal fill operation, please switch to another toolkit (currently, the "Split Segments" toolkit is active).`,
      );
      return;
    }
    if (planeId !== "PLANE_XY") {
      Toast.warning(
        `Within the "Split Segments" toolkit, the fill tool is only supported in the XY viewport. Please use the tool in the XY viewport or switch to another toolkit.`,
      );
      return;
    }
  }

  const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);

  if (busyBlockingInfo.isBusy) {
    console.warn(`Ignoring floodfill request (reason: ${busyBlockingInfo.reason || "unknown"})`);
    return;
  }
  // As the flood fill will be applied to the volume layer,
  // the potentially existing mapping should be locked to ensure a consistent state.
  const isModificationAllowed = yield* call(
    requestBucketModificationInVolumeTracing,
    volumeTracing,
  );
  if (!isModificationAllowed) {
    return;
  }
  const finestSegmentationLayerMag = magInfo.getFinestMag();
  const boundingBoxForFloodFill = yield* call(
    getBoundingBoxForFloodFill,
    seedPosition,
    planeId,
    finestSegmentationLayerMag,
  );
  if ("failureReason" in boundingBoxForFloodFill) {
    Toast.warning(boundingBoxForFloodFill.failureReason, {
      key: NO_FLOODFILL_BBOX_TOAST_KEY,
    });
    return;
  } else {
    Toast.close(NO_FLOODFILL_BBOX_TOAST_KEY);
  }
  yield* put(setBusyBlockingInfoAction(true, "Floodfill is being computed."));
  const progressCallback = createProgressCallback({
    pauseDelay: 200,
    successMessageDelay: 2000,
  });
  yield* call(progressCallback, false, "Performing floodfill...");
  console.time("cube.floodFill");
  const startTimeOfFloodfill = performance.now();
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
    splitBoundaryMesh,
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

  yield* call(
    notifyUserAboutResult,
    wasBoundingBoxExceeded,
    startTimeOfFloodfill,
    progressCallback,
    fillMode,
    coveredBoundingBox,
    oldSegmentIdAtSeed,
    activeCellId,
    seedPosition,
  );

  cube.triggerPushQueue();
  yield* put(setBusyBlockingInfoAction(false));

  if (floodFillAction.callback != null) {
    floodFillAction.callback();
  }
}

function* notifyUserAboutResult(
  wasBoundingBoxExceeded: boolean,
  startTimeOfFloodfill: number,
  progressCallback: ProgressCallback,
  fillMode: FillMode,
  coveredBoundingBox: BoundingBoxType,
  oldSegmentIdAtSeed: number,
  activeCellId: number,
  seedPosition: Vector3,
) {
  let showSuccessMsg = false;
  if (wasBoundingBoxExceeded) {
    const isRestrictedToBoundingBox = yield* select(
      (state) => state.userConfiguration.isFloodfillRestrictedToBoundingBox,
    );
    // Don't notify the user about early-terminated floodfills if the floodfill
    // was configured to be restricted, anyway. Also, don't create a new bounding
    // box in that case.
    if (!isRestrictedToBoundingBox) {
      // The bounding box is overkill for the 2D mode because in that case,
      // it's trivial to check the borders manually.
      const createNewBoundingBox = fillMode === FillModeEnum._3D;
      const warningDetails = createNewBoundingBox
        ? "A bounding box that represents the labeled volume was added so that you can check the borders manually."
        : "Please check the borders of the filled area manually and use the fill tool again if necessary.";

      // Pre-declare a variable for the hide function so that we can refer
      // to that var within the toast content. We don't want to use message.destroy
      // because this ignores the setTimeout within the progress callback utility.
      // Without this, hide functions for older toasts could still be triggered (due to
      // timeout) that act on new ones then.
      let hideBox: { hideFn: () => void } | undefined;
      hideBox = yield* call(
        progressCallback,
        true,
        <>
          Floodfill is done, but terminated because{" "}
          {isRestrictedToBoundingBox
            ? "the labeled volume touched the bounding box to which the floodfill was restricted"
            : "the labeled volume got too large"}
          .
          <br />
          {warningDetails} {Unicode.NonBreakingSpace}
          <a href="#" style={{ pointerEvents: "auto" }} onClick={() => hideBox?.hideFn()}>
            Close
          </a>
        </>,
        {
          successMessageDelay: 10000,
        },
      );
      if (createNewBoundingBox) {
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
      showSuccessMsg = true;
    }
  } else {
    showSuccessMsg = true;
  }

  const floodfillDuration = performance.now() - startTimeOfFloodfill;
  const wasFloodfillQuick = floodfillDuration < NO_SUCCESS_MSG_WHEN_WITHIN_MS;

  if (showSuccessMsg) {
    const { hideFn } = yield* call(progressCallback, true, "Floodfill done.");
    if (wasFloodfillQuick) {
      hideFn();
    }
  }
}
