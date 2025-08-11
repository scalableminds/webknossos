import { formatVoxels } from "libs/format_utils";
import Toast from "libs/toast";
import {
  computeArrayFromBoundingBox,
  computeBoundingBoxFromBoundingBoxObject,
  rgbToHex,
} from "libs/utils";
import type { APIDataLayer, VoxelSize } from "types/api_types";
import { APIJobType } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import { UnitShort } from "viewer/constants";
import { getMagInfo } from "viewer/model/accessors/dataset_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { convertVoxelSizeToUnit } from "viewer/model/scaleinfo";
import type { UserBoundingBox } from "viewer/store";
import { MEAN_VX_SIZE, MIN_BBOX_EXTENT, type ModalJobTypes } from "./constants";

export const getMinimumDSSize = (jobType: ModalJobTypes) => {
  switch (jobType) {
    case APIJobType.INFER_NEURONS:
    case APIJobType.INFER_NUCLEI:
      return MIN_BBOX_EXTENT[jobType].map((dim) => dim * 2);
    case APIJobType.INFER_MITOCHONDRIA:
      return MIN_BBOX_EXTENT[jobType].map((dim) => dim + 80);
  }
};

export function renderUserBoundingBox(
  bbox: UserBoundingBox | null | undefined,
  showVolume: boolean,
) {
  if (!bbox) {
    return null;
  }

  const upscaledColor = bbox.color.map((colorPart) => colorPart * 255) as any as Vector3;
  const colorAsHexString = rgbToHex(upscaledColor);
  const volumeInVx = new BoundingBox(bbox.boundingBox).getVolume();
  return (
    <>
      <div
        className="color-display-wrapper"
        style={{
          backgroundColor: colorAsHexString,
          marginTop: -2,
          marginRight: 6,
        }}
      />
      {bbox.name} ({computeArrayFromBoundingBox(bbox.boundingBox).join(", ")}
      {showVolume ? `, ${formatVoxels(volumeInVx)}` : ""})
    </>
  );
}

export function getBoundingBoxesForLayers(layers: APIDataLayer[]): UserBoundingBox[] {
  return layers.map((layer, index) => {
    return {
      id: -1 * index,
      name: `Full ${layer.name} layer`,
      boundingBox: computeBoundingBoxFromBoundingBoxObject(layer.boundingBox),
      color: [255, 255, 255],
      isVisible: true,
    };
  });
}

// This function mirrors the selection of the mag
// in voxelytics/worker/job_utils/voxelytics_utils.py select_mag_for_model_prediction
// Make sure to keep it in sync
export const getBestFittingMagComparedToTrainingDS = (
  colorLayer: APIDataLayer,
  datasetScaleMag1: VoxelSize,
  jobType: APIJobType.INFER_MITOCHONDRIA | APIJobType.INFER_NEURONS | APIJobType.INFER_NUCLEI,
) => {
  if (jobType === APIJobType.INFER_MITOCHONDRIA) {
    // infer_mitochondria_model always infers on the finest mag of the current dataset
    const magInfo = getMagInfo(colorLayer.resolutions);
    return magInfo.getFinestMag();
  }
  const modelScale = MEAN_VX_SIZE[jobType];
  let closestMagOfCurrentDS = colorLayer.resolutions[0];
  let bestDifference = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];

  const datasetScaleInNm = convertVoxelSizeToUnit(datasetScaleMag1, UnitShort.nm);

  for (const mag of colorLayer.resolutions) {
    const diff = datasetScaleInNm.map((dim, i) =>
      Math.abs(Math.log(dim * mag[i]) - Math.log(modelScale[i])),
    );
    if (bestDifference[0] > diff[0]) {
      bestDifference = diff;
      closestMagOfCurrentDS = mag;
    }
  }
  const maxDistance = Math.max(...bestDifference);
  const resultText = `Using mag [${closestMagOfCurrentDS}]. This results in an effective voxel size of [${datasetScaleInNm.map((scale, i) => Math.round(scale * closestMagOfCurrentDS[i]))}] (compared to voxel size [${modelScale.map((scale) => Math.round(scale))}] used during training).`;
  if (maxDistance > Math.log(2)) {
    Toast.warning(resultText);
  } else {
    Toast.info(resultText);
    console.info(resultText);
  }
  return closestMagOfCurrentDS;
};

export const isBBoxTooSmall = (
  bbox: Vector3,
  segmentationType: ModalJobTypes,
  mag: Vector3,
  bboxOrDS: "bbox" | "dataset" = "bbox",
) => {
  const minBBoxExtentInModelMag =
    bboxOrDS === "dataset" ? getMinimumDSSize(segmentationType) : MIN_BBOX_EXTENT[segmentationType];
  const minExtentInMag1 = minBBoxExtentInModelMag.map((extent, i) =>
    Math.round(extent * mag[i]),
  ) as Vector3;
  for (let i = 0; i < 3; i++) {
    if (bbox[i] < minExtentInMag1[i]) {
      const boundingBoxOrDSMessage = bboxOrDS === "bbox" ? "bounding box" : "dataset";
      Toast.error(
        `The ${boundingBoxOrDSMessage} is too small. Please select a ${boundingBoxOrDSMessage} with the minimal extent ${minExtentInMag1} vx.`,
      );
      return true;
    }
  }
  return false;
};

export const isDatasetOrBoundingBoxTooSmall = (
  bbox: Vector6,
  mag: Vector3,
  colorLayer: APIDataLayer,
  segmentationType: ModalJobTypes,
): boolean => {
  const datasetExtent: Vector3 = [
    colorLayer.boundingBox.width,
    colorLayer.boundingBox.height,
    colorLayer.boundingBox.depth,
  ];
  if (isBBoxTooSmall(datasetExtent, segmentationType, mag, "dataset")) {
    return true;
  }
  const bboxExtent = bbox.slice(3) as Vector3;
  if (isBBoxTooSmall(bboxExtent, segmentationType, mag)) {
    return true;
  }
  return false;
};
