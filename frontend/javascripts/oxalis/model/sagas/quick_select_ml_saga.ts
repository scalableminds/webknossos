import { getSamMask, sendAnalyticsEvent } from "admin/admin_rest_api";
import { estimateBBoxInMask } from "libs/find_bounding_box_in_nd";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { map3, sleep } from "libs/utils";
import _ from "lodash";
import ndarray, { type NdArray } from "ndarray";
import { WkDevFlags } from "oxalis/api/wk_dev";
import type { OrthoView, TypedArrayWithoutBigInt, Vector2, Vector3 } from "oxalis/constants";
import type {
  ComputeQuickSelectForPointAction,
  ComputeQuickSelectForRectAction,
} from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import type { OxalisState } from "oxalis/store";
import { call, cancel, fork, put } from "typed-redux-saga";
import type { APIDataset, AdditionalCoordinate } from "types/api_flow_types";
import { getPlaneExtentInVoxelFromStore } from "../accessors/view_mode_accessor";
import { setGlobalProgressAction } from "../actions/ui_actions";
import Dimensions from "../dimensions";
import { finalizeQuickSelectForSlice, prepareQuickSelect } from "./quick_select_heuristic_saga";

const MAXIMUM_MASK_BASE = 1024;

// This should tend to be smaller because the progress rendering at the end of the animation
// can cope very well with faster operations (the end of the progress bar will finish very slowly).
// Abruptly terminating progress bars on the other hand can feel weird.
const EXPECTED_DURATION_PER_SLICE_MS = 500;

// The 1024**2 binary mask typically only contains data in the middle (where the user
// drew a bounding box). Starting from there, we increase the bounding box in steps until
// the borders only contain zeros. The increment for that is defined in the following constant.
const MAXIMUM_PADDING_ERROR = 100;

function* getMask(
  dataset: APIDataset,
  layerName: string,
  userBoxMag1: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
  additionalCoordinates: AdditionalCoordinate[],
  intensityRange?: Vector2 | null,
): Saga<[BoundingBox, Array<NdArray<TypedArrayWithoutBigInt>>]> {
  const usePointPrompt = userBoxMag1.getVolume() === 0;
  const trans = (vec: Vector3) => Dimensions.transDim(vec, activeViewport);
  const centerMag1 = V3.round(userBoxMag1.getCenter());

  const viewportExtentInMag = yield* select((state) => {
    const [width, height] = getPlaneExtentInVoxelFromStore(
      state,
      state.flycam.zoomStep,
      activeViewport,
    );
    const [u, v] = Dimensions.getIndices(activeViewport);

    return Math.ceil(Math.max(width / mag[u], height / mag[v]));
  });
  const maskSizeBase = Math.min(MAXIMUM_MASK_BASE, viewportExtentInMag + 100);
  const maskSize = (
    WkDevFlags.sam.useLocalMask ? [maskSizeBase, maskSizeBase, 0] : [1024, 1024, 0]
  ) as Vector3;

  const sizeInMag1 = V3.scale3(trans(maskSize), mag);
  const maskTopLeftMag1 = V3.alignWithMag(V3.sub(centerMag1, V3.scale(sizeInMag1, 0.5)), mag);

  const depth = yield* select(
    (state: OxalisState) => state.userConfiguration.quickSelect.predictionDepth || 1,
  );

  // Effectively, zero the first and second dimension in the mag.
  const depthSummand = V3.scale3(mag, trans([0, 0, depth]));
  const maskBottomRightMag1 = V3.add(maskTopLeftMag1, sizeInMag1);
  const maskBoxMag1 = new BoundingBox({
    min: maskTopLeftMag1,
    max: V3.add(maskBottomRightMag1, depthSummand),
  });

  if (!maskBoxMag1.containsBoundingBox(userBoxMag1)) {
    // This is unlikely as the mask size of 1024**2 is quite large.
    // The UX can certainly be optimized in case users run into this problem
    // more often.
    throw new Error("Selected bounding box is too large for AI selection.");
  }

  const userBoxInMag = userBoxMag1.fromMag1ToMag(mag);
  const maskBoxInMag = maskBoxMag1.fromMag1ToMag(mag);
  const userBoxRelativeToMaskInMag = userBoxInMag.offset(V3.negate(maskBoxInMag.min));

  const minUV = userBoxRelativeToMaskInMag.getMinUV(activeViewport);
  const maxUV = userBoxRelativeToMaskInMag.getMaxUV(activeViewport);

  const maskData = yield* call(
    getSamMask,
    dataset,
    layerName,
    mag,
    maskBoxMag1,
    usePointPrompt
      ? {
          type: "POINT",
          pointX: minUV[0],
          pointY: minUV[1],
        }
      : {
          type: "BOUNDING_BOX",
          selectionTopLeftX: minUV[0],
          selectionTopLeftY: minUV[1],
          selectionBottomRightX: maxUV[0],
          selectionBottomRightY: maxUV[1],
        },
    additionalCoordinates,
    intensityRange,
  );

  const size = maskBoxInMag.getSize();
  const sizeUVW = trans(size);
  const stride = [sizeUVW[2] * sizeUVW[1], sizeUVW[2], 1];

  const ndarr = ndarray(maskData, sizeUVW, stride);

  // a.hi(x,y) => a[:x, :y]
  // a.lo(x,y) => a[x:, y:]
  return [
    maskBoxInMag,
    _.range(0, depth).map((zOffset) =>
      ndarr.hi(ndarr.shape[0], ndarr.shape[1], zOffset + 1).lo(0, 0, zOffset),
    ),
  ];
}

function* showApproximatelyProgress(amount: number, expectedDurationPerItemMs: number) {
  // The progress bar is split into amount + 1 chunks. The first amount
  // chunks are filled after expectedDurationPerItemMs passed.
  // Afterwards, only one chunk is missing. With each additional iteration,
  // the remaining progress is split into half.
  let progress = 0;
  let i = 0;
  const increment = 1 / (amount + 1);
  while (true) {
    yield* call(sleep, expectedDurationPerItemMs);
    if (i < amount) {
      progress += increment;
    } else {
      progress += increment / 2 ** (i - amount + 1);
    }
    yield* put(setGlobalProgressAction(progress));
    i++;
  }
}

export default function* performQuickSelect(
  action: ComputeQuickSelectForRectAction | ComputeQuickSelectForPointAction,
): Saga<void> {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  if (additionalCoordinates && additionalCoordinates.length > 0) {
    Toast.warning(
      `Quick select with AI might produce unexpected results for ${
        3 + additionalCoordinates.length
      }D datasets.`,
    );
  }

  const preparation = yield* call(prepareQuickSelect, action);
  if (preparation == null) {
    return;
  }
  const depth = yield* select(
    (state: OxalisState) => state.userConfiguration.quickSelect.predictionDepth || 1,
  );
  const progressSaga = yield* fork(
    showApproximatelyProgress,
    depth,
    EXPECTED_DURATION_PER_SLICE_MS,
  );
  try {
    const { labeledZoomStep, labeledMag, thirdDim, activeViewport, volumeTracing, colorLayer } =
      preparation;
    const trans = (vec: Vector3) => Dimensions.transDim(vec, activeViewport);

    const { type, quickSelectGeometry } = action;

    let startPosition;
    let endPosition;
    if (type === "COMPUTE_QUICK_SELECT_FOR_POINT") {
      // We use the click position for both start and end position so that
      // the logic dealing for centering the mask etc can be done with the
      // same code. The resulting bounding box will have a volume of 0 which
      // is okay.
      startPosition = action.position;
      endPosition = action.position;
    } else {
      startPosition = action.startPosition;
      endPosition = action.endPosition;
    }

    // Effectively, zero the first and second dimension in the mag.
    const depthSummand = V3.scale3(labeledMag, trans([0, 0, 1]));
    const unalignedUserBoxMag1 = new BoundingBox({
      min: V3.floor(V3.min(startPosition, endPosition)),
      max: V3.floor(V3.add(V3.max(startPosition, endPosition), depthSummand)),
    });
    // Ensure that the third dimension is inclusive (otherwise, the center of the passed
    // coordinates wouldn't be exactly on the W plane on which the user started this action).
    const inclusiveMaxW = map3(
      (el, idx) => (idx === thirdDim ? el - 1 : el),
      unalignedUserBoxMag1.max,
    );
    quickSelectGeometry.setCoordinates(unalignedUserBoxMag1.min, inclusiveMaxW);

    const alignedUserBoxMag1 = unalignedUserBoxMag1.alignWithMag(labeledMag, "floor");
    const dataset = yield* select((state: OxalisState) => state.dataset);
    const layerConfiguration = yield* select(
      (state) => state.datasetConfiguration.layers[colorLayer.name],
    );
    const { intensityRange } = layerConfiguration;

    let masks: Array<NdArray<TypedArrayWithoutBigInt>> | undefined;
    let maskBoxInMag: BoundingBox | undefined;
    try {
      const retVal = yield* call(
        getMask,
        dataset,
        colorLayer.name,
        alignedUserBoxMag1,
        labeledMag,
        activeViewport,
        additionalCoordinates || [],
        colorLayer.elementClass === "uint8" ? null : intensityRange,
      );
      [maskBoxInMag, masks] = retVal;
    } catch (exception) {
      console.error(exception);
      throw new Error("Could not infer mask. See console for details.");
    }

    const overwriteMode = yield* select(
      (state: OxalisState) => state.userConfiguration.overwriteMode,
    );

    sendAnalyticsEvent("used_quick_select_with_ai");

    let userBoxInMag = alignedUserBoxMag1.fromMag1ToMag(labeledMag);
    if (action.type === "COMPUTE_QUICK_SELECT_FOR_POINT") {
      // In the point case, the bounding box will have a volume of zero which
      // prevents the estimateBBoxInMask call from inferring the correct bbox.
      // Therefore, we enlarge the bounding box by one pixel in u and v.
      userBoxInMag = userBoxInMag.paddedWithMargins([0, 0, 0], trans([1, 1, 0]));
    }
    const userBoxRelativeToMaskInMag = userBoxInMag.offset(V3.negate(maskBoxInMag.min));

    let wOffset = 0;
    const currentEstimationInputForBBoxEstimation = {
      min: userBoxRelativeToMaskInMag.getMinUV(activeViewport),
      max: userBoxRelativeToMaskInMag.getMaxUV(activeViewport),
    };
    for (const mask of masks) {
      const targetW = alignedUserBoxMag1.min[thirdDim] + labeledMag[thirdDim] * wOffset;

      const { min: minUV, max: maxUV } = estimateBBoxInMask(
        mask,
        currentEstimationInputForBBoxEstimation,
        MAXIMUM_PADDING_ERROR,
      );
      // Use the estimated bbox as input for the next iteration so that
      // moving segments don't "exit" the used bbox at the some point in W.
      currentEstimationInputForBBoxEstimation.min = minUV;
      currentEstimationInputForBBoxEstimation.max = maxUV;

      // Span a bbox from the estimated values (relative to the mask)
      // and move it by the mask's min position to achieve a global
      // bbox.
      const targetBox = new BoundingBox({
        min: trans([...minUV, 0]),
        max: trans([...maxUV, labeledMag[thirdDim]]),
      }).offset(maskBoxInMag.min);

      // Let the UI (especially the progress bar) update
      yield* call(sleep, 10);
      yield* finalizeQuickSelectForSlice(
        quickSelectGeometry,
        volumeTracing,
        activeViewport,
        labeledMag,
        targetBox.fromMagToMag1(labeledMag),
        targetW,
        // a.hi(x,y) => a[:x, :y], // a.lo(x,y) => a[x:, y:]
        mask
          .hi(maxUV[0], maxUV[1], 1)
          .lo(minUV[0], minUV[1], 0),
        overwriteMode,
        labeledZoomStep,
        // Only finish annotation stroke in the last iteration.
        // This allows to undo the entire multi-slice operation in one go.
        wOffset < masks.length - 1,
      );
      wOffset++;
    }
  } finally {
    yield* cancel(progressSaga);
    yield* put(setGlobalProgressAction(1));
    yield* call(sleep, 1000);
    yield* put(setGlobalProgressAction(0));
  }
}
