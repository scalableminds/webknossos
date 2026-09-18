import { getSamMask, type SamPrompt, sendAnalyticsEvent } from "admin/rest_api";
import { collectLabelBoundingBoxes, estimateBBoxInMask } from "libs/find_bounding_box_in_nd";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { map3, sleep } from "libs/utils";
import range from "lodash-es/range";
import ndarray, { type NdArray } from "ndarray";
import { call, cancel, fork, put } from "typed-redux-saga";
import type { AdditionalCoordinate, APIDataset } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { OrthoView, TypedArrayWithoutBigInt, Vector3 } from "viewer/constants";
import type {
  ComputeQuickSelectForExemplarsAction,
  ComputeQuickSelectForPointAction,
  ComputeQuickSelectForRectAction,
} from "viewer/model/actions/volumetracing_actions";
import {
  setLargestSegmentIdAction,
  updateSegmentAction,
} from "viewer/model/actions/volumetracing_actions";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { api } from "viewer/singletons";
import type { WebknossosState } from "viewer/store";
import { MISSING_GROUP_ID } from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { getPlaneExtentInVoxelFromStore } from "../../../accessors/view_mode_accessor";
import { setGlobalProgressAction } from "../../../actions/ui_actions";
import Dimensions from "../../../dimensions";
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

// Exemplar prompts run the model's full detector on every slice instead of tracking one object,
// which is dramatically slower: measured at roughly 30s per 512x512 slice against a local sam3
// backend, versus well under a second for an interactive prompt on the same volume.
const EXPECTED_EXEMPLAR_DURATION_PER_SLICE_MS = 30000;

// SAM 3.1 is built with max_num_objects=16 and silently drops detections beyond that. The uint8
// label ceiling of 255 is never the binding limit.
const MAXIMUM_EXEMPLAR_INSTANCES = 16;

type MaskGeometry = {
  maskBoxMag1: BoundingBox;
  maskBoxInMag: BoundingBox;
  depth: number;
};

/*
 * The model always works on a square tile centered on whatever the user pointed at, which must
 * fit inside that tile. Shared by all prompt types.
 */
function* computeMaskGeometry(
  containedBoxMag1: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
): Saga<MaskGeometry> {
  const trans = (vec: Vector3) => Dimensions.transDim(vec, activeViewport);
  const centerMag1 = V3.round(containedBoxMag1.getCenter());

  const viewportExtentInMag = yield* select((state) => {
    const [width, height] = getPlaneExtentInVoxelFromStore(
      state,
      state.flycam.zoomStep,
      activeViewport,
    );
    const [u, v] = Dimensions.getIndices(activeViewport);

    return Math.ceil(Math.max(width / mag[u], height / mag[v]));
  });
  // The tile has to cover the whole prompt. For a single box that is a given, but a set of
  // exemplar boxes can span much more than the viewport-derived size -- and when zoomed out far
  // enough that the viewport itself exceeds the cap, the tile would even be smaller than what the
  // user can see. Grow it to fit, still bounded by what the model accepts.
  const [uDim, vDim] = Dimensions.getIndices(activeViewport);
  const containedSizeInMag = containedBoxMag1.fromMag1ToMag(mag).getSize();
  // Two extra voxels of slack: centering the tile floors it onto the mag grid, which can cost up
  // to one voxel on each side.
  const requiredBase = Math.max(containedSizeInMag[uDim], containedSizeInMag[vDim]) + 2;
  const maskSizeBase = Math.min(
    MAXIMUM_MASK_BASE,
    Math.max(viewportExtentInMag + 100, requiredBase),
  );
  const maskSize = (
    WkDevFlags.sam.useLocalMask ? [maskSizeBase, maskSizeBase, 0] : [1024, 1024, 0]
  ) as Vector3;

  const sizeInMag1 = V3.scale3(trans(maskSize), mag);
  const maskTopLeftMag1 = V3.alignWithMag(V3.sub(centerMag1, V3.scale(sizeInMag1, 0.5)), mag);

  const depth = yield* select(
    (state: WebknossosState) => state.userConfiguration.quickSelect.predictionDepth || 1,
  );

  // Effectively, zero the first and second dimension in the mag.
  const depthSummand = V3.scale3(mag, trans([0, 0, depth]));
  const maskBottomRightMag1 = V3.add(maskTopLeftMag1, sizeInMag1);
  const maskBoxMag1 = new BoundingBox({
    min: maskTopLeftMag1,
    max: V3.add(maskBottomRightMag1, depthSummand),
  });

  if (!maskBoxMag1.containsBoundingBox(containedBoxMag1)) {
    // Reachable when the prompt is wider than the model's maximum tile, which a set of exemplar
    // boxes spread across the view can easily be. Name the actual numbers, since "too large" on
    // its own gives the user nothing to act on.
    throw new Error(
      `The selected region is too large for AI selection: it spans ${containedSizeInMag[uDim]}×${containedSizeInMag[vDim]} voxels at the current magnification, but at most ${MAXIMUM_MASK_BASE}×${MAXIMUM_MASK_BASE} can be processed. Zoom in, or draw the boxes closer together.`,
    );
  }

  return { maskBoxMag1, maskBoxInMag: maskBoxMag1.fromMag1ToMag(mag), depth };
}

// Maps a mag1 box into the mask's own coordinate frame, in the target mag.
function toMaskRelativeUV(
  boxMag1: BoundingBox,
  mag: Vector3,
  maskBoxInMag: BoundingBox,
  activeViewport: OrthoView,
) {
  const relative = boxMag1.fromMag1ToMag(mag).offset(V3.negate(maskBoxInMag.min));
  return {
    minUV: relative.getMinUV(activeViewport),
    maxUV: relative.getMaxUV(activeViewport),
  };
}

function* fetchMaskSlices(
  dataset: APIDataset,
  layerName: string,
  mag: Vector3,
  geometry: MaskGeometry,
  activeViewport: OrthoView,
  prompt: SamPrompt,
  additionalCoordinates: AdditionalCoordinate[],
  intensityRange?: readonly [number, number] | null,
): Saga<Array<NdArray<TypedArrayWithoutBigInt>>> {
  const maskData = yield* call(
    getSamMask,
    dataset,
    layerName,
    mag,
    geometry.maskBoxMag1,
    prompt,
    additionalCoordinates,
    intensityRange,
  );

  const trans = (vec: Vector3) => Dimensions.transDim(vec, activeViewport);
  const sizeUVW = trans(geometry.maskBoxInMag.getSize());
  const stride = [sizeUVW[2] * sizeUVW[1], sizeUVW[2], 1];

  const ndarr = ndarray(maskData, sizeUVW, stride);

  // a.hi(x,y) => a[:x, :y]
  // a.lo(x,y) => a[x:, y:]
  return range(0, geometry.depth).map(
    (zOffset) =>
      ndarr.hi(ndarr.shape[0], ndarr.shape[1], zOffset + 1).lo(0, 0, zOffset) as NdArray<
        Uint8Array<ArrayBuffer>
      >,
  );
}

function* getMask(
  dataset: APIDataset,
  layerName: string,
  userBoxMag1: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
  additionalCoordinates: AdditionalCoordinate[],
  intensityRange?: readonly [number, number] | null,
): Saga<[BoundingBox, Array<NdArray<TypedArrayWithoutBigInt>>]> {
  const usePointPrompt = userBoxMag1.getVolume() === 0;
  const geometry = yield* call(computeMaskGeometry, userBoxMag1, mag, activeViewport);
  const { minUV, maxUV } = toMaskRelativeUV(
    userBoxMag1,
    mag,
    geometry.maskBoxInMag,
    activeViewport,
  );

  const prompt: SamPrompt = usePointPrompt
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
      };

  const masks = yield* call(
    fetchMaskSlices,
    dataset,
    layerName,
    mag,
    geometry,
    activeViewport,
    prompt,
    additionalCoordinates,
    intensityRange,
  );
  return [geometry.maskBoxInMag, masks];
}

function* showApproximatelyProgress(
  amount: number,
  expectedDurationPerItemMs: number,
): Saga<never> {
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
    (state: WebknossosState) => state.userConfiguration.quickSelect.predictionDepth || 1,
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
    const dataset = yield* select((state: WebknossosState) => state.dataset);
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
      (state: WebknossosState) => state.userConfiguration.overwriteMode,
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
        mask.hi(maxUV[0], maxUV[1], 1).lo(minUV[0], minUV[1], 0),
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

/*
 * Exemplar-based quick select. In contrast to the point and rectangle variants, which track the
 * one object the user pointed at, this asks the model's detector to find every instance that
 * resembles the drawn examples. The response is a label map whose ids are stable across slices,
 * so each id becomes one segment spanning all the slices it appears on.
 */
export function* performExemplarQuickSelect(
  action: ComputeQuickSelectForExemplarsAction,
): Saga<void> {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  if (additionalCoordinates && additionalCoordinates.length > 0) {
    Toast.warning(
      `Quick select with AI might produce unexpected results for ${
        3 + additionalCoordinates.length
      }D datasets.`,
    );
  }

  const { boxes, quickSelectGeometry } = action;

  if (boxes.length === 0) {
    Toast.warning("Draw at least one exemplar box before running the detection.");
    return;
  }
  // The boxes carry the viewport they were drawn in, because the run is triggered from the
  // toolbar by which time the active viewport has followed the mouse elsewhere. Reading the
  // section axis from the active viewport would silently use the wrong axis.
  const drawnViewports = new Set(boxes.map((box) => box.viewport));
  if (drawnViewports.size > 1) {
    Toast.error(
      "All exemplar boxes must be drawn in the same viewport. Clear them and draw again in one viewport.",
    );
    return;
  }

  const preparation = yield* call(prepareQuickSelect, action, boxes[0].viewport);
  if (preparation == null) {
    return;
  }
  const { labeledZoomStep, labeledMag, thirdDim, activeViewport, volumeTracing, colorLayer } =
    preparation;
  const trans = (vec: Vector3) => Dimensions.transDim(vec, activeViewport);

  /*
   * Every exemplar has to sit on one section: the prediction starts there and propagates forward.
   * The section cannot be read off each box directly, though. calculateGlobalPos derives the third
   * dimension as Math.floor of a position that has been rotated through the flycam matrix, so the
   * floating-point noise of that rotation makes boxes drawn at different screen positions on the
   * *same* section land on adjacent integers. Since an exemplar prompt is 2D anyway -- W only
   * picks the section to start from -- pin them all to one section instead of treating that
   * jitter as a real difference, and only complain when they are genuinely further apart.
   */
  const sectionCandidates = boxes.map((box) => box.min[thirdDim]);
  const sectionW = Math.min(...sectionCandidates);
  if (Math.max(...sectionCandidates) - sectionW > labeledMag[thirdDim]) {
    Toast.error(
      "All exemplar boxes must be on the same section. Clear them and draw again without scrolling.",
    );
    return;
  }

  const depth = yield* select(
    (state: WebknossosState) => state.userConfiguration.quickSelect.predictionDepth || 1,
  );
  const progressSaga = yield* fork(
    showApproximatelyProgress,
    depth,
    EXPECTED_EXEMPLAR_DURATION_PER_SLICE_MS,
  );

  try {
    // Give the third dimension an extent of one section, mirroring the rectangle variant.
    const depthSummand = V3.scale3(labeledMag, trans([0, 0, 1]));
    const exemplarBoxesMag1 = boxes.map((box) => {
      const min = [...V3.floor(V3.min(box.min, box.max))] as Vector3;
      const max = [...V3.floor(V3.max(box.min, box.max))] as Vector3;
      // Pin to the shared section (see above), so the union cannot span two of them.
      min[thirdDim] = sectionW;
      max[thirdDim] = sectionW;
      return new BoundingBox({ min, max: V3.add(max, depthSummand) });
    });
    // The mask tile has to contain every exemplar, so center it on their union rather than on any
    // single box.
    const unionMag1 = exemplarBoxesMag1
      .slice(1)
      .reduce((acc, box) => acc.extend(box), exemplarBoxesMag1[0])
      .alignWithMag(labeledMag, "floor");
    quickSelectGeometry.setCoordinates([0, 0, 0], [0, 0, 0]);

    const dataset = yield* select((state: WebknossosState) => state.dataset);
    const layerConfiguration = yield* select(
      (state) => state.datasetConfiguration.layers[colorLayer.name],
    );
    const { intensityRange } = layerConfiguration;

    let geometry: MaskGeometry;
    let masks: Array<NdArray<TypedArrayWithoutBigInt>>;
    try {
      geometry = yield* call(computeMaskGeometry, unionMag1, labeledMag, activeViewport);
      const prompt: SamPrompt = {
        type: "EXEMPLAR_BOXES",
        exemplarBoxes: exemplarBoxesMag1.map((boxMag1, index) => {
          const { minUV, maxUV } = toMaskRelativeUV(
            boxMag1.alignWithMag(labeledMag, "floor"),
            labeledMag,
            geometry.maskBoxInMag,
            activeViewport,
          );
          if (maxUV[0] <= minUV[0] || maxUV[1] <= minUV[1]) {
            // A zero-area prompt gives the detector nothing to match on, so fail loudly here
            // rather than sending a degenerate box and getting an opaque server error.
            throw new Error(
              "An exemplar box has no area at the current magnification. Draw larger boxes, or zoom in.",
            );
          }
          // Same field order as the bounding box prompt, so that the server's coordinate handling
          // applies identically to both.
          return {
            topLeftX: minUV[0],
            topLeftY: minUV[1],
            bottomRightX: maxUV[0],
            bottomRightY: maxUV[1],
            label: boxes[index].label,
          };
        }),
      };
      masks = yield* call(
        fetchMaskSlices,
        dataset,
        colorLayer.name,
        labeledMag,
        geometry,
        activeViewport,
        prompt,
        additionalCoordinates || [],
        colorLayer.elementClass === "uint8" ? null : intensityRange,
      );
    } catch (exception) {
      console.error(exception);
      throw new Error("Could not infer instances. See console for details.");
    }

    const overwriteMode = yield* select(
      (state: WebknossosState) => state.userConfiguration.overwriteMode,
    );

    sendAnalyticsEvent("used_quick_select_with_exemplars");

    // One pass per slice yields every instance's bounding box; ids are stable across slices, so
    // the same id refers to the same instance everywhere it occurs.
    const boundsPerSlice = masks.map(collectLabelBoundingBoxes);
    const instanceIds = Array.from(
      new Set(boundsPerSlice.flatMap((bounds) => Array.from(bounds.keys()))),
    ).sort((a, b) => a - b);

    if (instanceIds.length === 0) {
      Toast.warning("No instances were detected for the given exemplars.");
      return;
    }
    if (instanceIds.length >= MAXIMUM_EXEMPLAR_INSTANCES) {
      // The model drops detections past its cap silently, and the response cannot tell us whether
      // that happened, so warn whenever we are at the limit.
      Toast.warning(
        `${MAXIMUM_EXEMPLAR_INSTANCES} instances were found, which is the maximum the model returns. Some instances may be missing — try a smaller region.`,
      );
    }

    // Reserve one segment id per instance up front. largestSegmentId is only advanced by the
    // reducer for the active cell, so it has to be updated explicitly below.
    const { activeCellId, largestSegmentId } = volumeTracing;
    const baseSegmentId =
      (largestSegmentId != null && largestSegmentId > activeCellId
        ? largestSegmentId
        : activeCellId) + 1n;
    const segmentIdByInstance = new Map<number, bigint>(
      instanceIds.map((id, index) => [id, baseSegmentId + BigInt(index)]),
    );

    let groupId: number | null = null;
    try {
      groupId = yield* call(
        [api.tracing, api.tracing.createSegmentGroup],
        `Exemplar selection (${instanceIds.length})`,
        MISSING_GROUP_ID,
        volumeTracing.tracingId,
      );
    } catch (_exception) {
      // Not fatal: the segments are still created, just not grouped.
      console.info("Could not create a segment group for the exemplar selection.");
    }

    // Every (instance, slice) pair is one write. Only the very last one finishes the annotation
    // stroke, so that the whole run undoes in a single step.
    const writes: Array<{ instanceId: number; sliceIndex: number }> = [];
    boundsPerSlice.forEach((bounds, sliceIndex) => {
      for (const instanceId of bounds.keys()) {
        writes.push({ instanceId, sliceIndex });
      }
    });

    for (const [writeIndex, { instanceId, sliceIndex }] of writes.entries()) {
      const bounds = boundsPerSlice[sliceIndex].get(instanceId);
      if (bounds == null) {
        continue;
      }
      const [minU, minV] = bounds.min;
      const [maxU, maxV] = bounds.max;
      const targetW = unionMag1.min[thirdDim] + labeledMag[thirdDim] * sliceIndex;
      const targetBox = new BoundingBox({
        min: trans([minU, minV, 0]),
        max: trans([maxU, maxV, labeledMag[thirdDim]]),
      }).offset(geometry.maskBoxInMag.min);

      // Let the UI (especially the progress bar) update
      yield* call(sleep, 10);
      yield* call(
        finalizeQuickSelectForSlice,
        quickSelectGeometry,
        volumeTracing,
        activeViewport,
        labeledMag,
        targetBox.fromMagToMag1(labeledMag),
        targetW,
        masks[sliceIndex].hi(maxU, maxV, 1).lo(minU, minV, 0),
        overwriteMode,
        labeledZoomStep,
        writeIndex < writes.length - 1,
        { labelValue: instanceId, segmentId: segmentIdByInstance.get(instanceId) as bigint },
      );
    }

    yield* put(setLargestSegmentIdAction(baseSegmentId + BigInt(instanceIds.length - 1)));
    for (const [index, instanceId] of instanceIds.entries()) {
      const segmentId = segmentIdByInstance.get(instanceId) as bigint;
      yield* put(
        updateSegmentAction(
          segmentId,
          { name: `Instance ${index + 1}`, ...(groupId != null ? { groupId } : {}) },
          volumeTracing.tracingId,
        ),
      );
    }
  } finally {
    yield* cancel(progressSaga);
    yield* put(setGlobalProgressAction(1));
    yield* call(sleep, 1000);
    yield* put(setGlobalProgressAction(0));
  }
}
