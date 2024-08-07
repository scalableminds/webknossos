import _ from "lodash";
import ndarray, { NdArray } from "ndarray";
import { OrthoView, TypedArrayWithoutBigInt, Vector2, Vector3 } from "oxalis/constants";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { call } from "typed-redux-saga";
import { select } from "oxalis/model/sagas/effect-generators";
import { V2, V3 } from "libs/mjs";
import { ComputeQuickSelectForRectAction } from "oxalis/model/actions/volumetracing_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import Toast from "libs/toast";
import { OxalisState } from "oxalis/store";
import { map3 } from "libs/utils";
import { AdditionalCoordinate, APIDataset } from "types/api_flow_types";
import { getSamMask, sendAnalyticsEvent } from "admin/admin_rest_api";
import Dimensions from "../dimensions";
import { finalizeQuickSelect, prepareQuickSelect } from "./quick_select_heuristic_saga";

const MASK_SIZE = [1024, 1024, 0] as Vector3;

async function getMask(
  dataset: APIDataset,
  layerName: string,
  userBoxMag1: BoundingBox,
  mag: Vector3,
  activeViewport: OrthoView,
  additionalCoordinates: AdditionalCoordinate[],
  intensityRange?: Vector2 | null,
): Promise<[BoundingBox, Array<NdArray<TypedArrayWithoutBigInt>>]> {
  if (userBoxMag1.getVolume() === 0) {
    throw new Error("User bounding box should not have empty volume.");
  }
  const centerMag1 = V3.round(userBoxMag1.getCenter());
  const sizeInMag1 = V3.scale3(Dimensions.transDim(MASK_SIZE, activeViewport), mag);
  const maskTopLeftMag1 = V3.alignWithMag(V3.sub(centerMag1, V3.scale(sizeInMag1, 0.5)), mag);
  // Effectively, zero the first and second dimension in the mag.
  const depth = window.depth || 2;
  const depthSummand = V3.scale3(mag, Dimensions.transDim([0, 0, depth], activeViewport));
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

  const maskData = await getSamMask(
    dataset,
    layerName,
    mag,
    maskBoxInMag,
    userBoxRelativeToMaskInMag.getMinUV(activeViewport),
    userBoxRelativeToMaskInMag.getMaxUV(activeViewport),
    additionalCoordinates,
    intensityRange,
  );

  const size = maskBoxInMag.getSize();
  const sizeUVW = Dimensions.transDim(size, activeViewport);
  const stride = [sizeUVW[2] * sizeUVW[1], sizeUVW[2], 1];

  console.log("size", size);
  console.log("stride", stride);
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

export default function* performQuickSelect(action: ComputeQuickSelectForRectAction): Saga<void> {
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
  const {
    labeledZoomStep,
    labeledResolution,
    firstDim,
    secondDim,
    thirdDim,
    activeViewport,
    volumeTracing,
    colorLayer,
  } = preparation;
  const { startPosition, endPosition, quickSelectGeometry } = action;

  // Effectively, zero the first and second dimension in the mag.
  const depthSummand = V3.scale3(labeledResolution, Dimensions.transDim([0, 0, 1], activeViewport));
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

  const alignedUserBoxMag1 = unalignedUserBoxMag1.alignWithMag(labeledResolution, "floor");
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
      labeledResolution,
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

  let zOffset = 0;
  for (const mask of masks) {
    const targetW = alignedUserBoxMag1.min[thirdDim] + zOffset;

    let minUV: Vector2 = [Infinity, Infinity];
    let maxUV: Vector2 = [0, 0];
    console.time("find bbox in mask");
    for (let u = 0; u < mask.shape[0]; u++) {
      for (let v = 0; v < mask.shape[1]; v++) {
        if (mask.get(u, v, 0) > 0) {
          minUV = V2.min(minUV, [u, v]);
          maxUV = V2.max(maxUV, [u, v]);
        }
      }
    }
    console.timeEnd("find bbox in mask");
    console.log("minUV", minUV);
    console.log("maxUV", maxUV);
    const sizeUVMinusMaxUV = V3.sub(Dimensions.transDim(mask.shape as Vector3, activeViewport), [
      ...maxUV,
      0,
    ] as Vector3);
    const targetBox = maskBoxInMag.paddedWithMargins(
      V3.negate(Dimensions.transDim([...minUV, 0], activeViewport)),
      V3.negate(Dimensions.transDim(sizeUVMinusMaxUV, activeViewport)),
    );

    yield* finalizeQuickSelect(
      quickSelectGeometry,
      volumeTracing,
      activeViewport,
      labeledResolution,
      targetBox.fromMagToMag1(labeledResolution),
      targetW,
      // a.hi(x,y) => a[:x, :y], // a.lo(x,y) => a[x:, y:]
      mask
        .hi(maxUV[0], maxUV[1], 1)
        .lo(minUV[0], minUV[1], 0),
      overwriteMode,
      labeledZoomStep,
    );
    zOffset++;
  }
}
