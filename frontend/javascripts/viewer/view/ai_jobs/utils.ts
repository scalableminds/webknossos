import type { Rule } from "antd/es/form";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { computeArrayFromBoundingBox, computeBoundingBoxFromBoundingBoxObject } from "libs/utils";
import _ from "lodash";
import type { APIAnnotation, APIDataLayer, APIDataset, VoxelSize } from "types/api_types";
import { APIJobCommand } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import { UnitShort } from "viewer/constants";
import { getColorLayers, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { getSegmentationLayerByHumanReadableName } from "viewer/model/accessors/volumetracing_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { convertVoxelSizeToUnit } from "viewer/model/scaleinfo";
import type { StoreAnnotation, UserBoundingBox, VolumeTracing } from "viewer/store";
import { MEAN_VX_SIZE, MIN_BBOX_EXTENT } from "./constants";

export const getMinimumDSSize = (jobType: APIJobCommand) => {
  switch (jobType) {
    case APIJobCommand.INFER_NEURONS:
    case APIJobCommand.INFER_NUCLEI:
    case APIJobCommand.INFER_INSTANCES:
      return MIN_BBOX_EXTENT[jobType].map((dim) => dim * 2);
    case APIJobCommand.INFER_MITOCHONDRIA:
      return MIN_BBOX_EXTENT[jobType].map((dim) => dim + 80);
    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
};

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
  jobType:
    | APIJobCommand.INFER_MITOCHONDRIA
    | APIJobCommand.INFER_NEURONS
    | APIJobCommand.INFER_NUCLEI
    | APIJobCommand.INFER_INSTANCES,
) => {
  if (jobType === APIJobCommand.INFER_MITOCHONDRIA || jobType === APIJobCommand.INFER_INSTANCES) {
    // infer_mitochondria_model always infers on the finest mag of the current dataset
    const magInfo = getMagInfo(colorLayer.mags);
    return magInfo.getFinestMag();
  }
  const modelScale = MEAN_VX_SIZE[jobType];
  let closestMagOfCurrentDS = colorLayer.mags[0].mag;
  let bestDifference = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];

  const datasetScaleInNm = convertVoxelSizeToUnit(datasetScaleMag1, UnitShort.nm);

  for (const magObj of colorLayer.mags) {
    const diff = datasetScaleInNm.map((dim, i) =>
      Math.abs(Math.log(dim * magObj.mag[i]) - Math.log(modelScale[i])),
    );
    if (bestDifference[0] > diff[0]) {
      bestDifference = diff;
      closestMagOfCurrentDS = magObj.mag;
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
  segmentationType:
    | APIJobCommand.INFER_INSTANCES
    | APIJobCommand.INFER_MITOCHONDRIA
    | APIJobCommand.INFER_NEURONS
    | APIJobCommand.INFER_NUCLEI,
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
  segmentationType:
    | APIJobCommand.INFER_INSTANCES
    | APIJobCommand.INFER_MITOCHONDRIA
    | APIJobCommand.INFER_NEURONS
    | APIJobCommand.INFER_NUCLEI,
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

export type AnnotationInfoForAITrainingJob<GenericAnnotation> = {
  annotation: GenericAnnotation;
  dataset: APIDataset;
  volumeTracings: VolumeTracing[];
  userBoundingBoxes: UserBoundingBox[];
  volumeTracingMags: { mag: Vector3 }[][];
};

export function checkAnnotationsForErrorsAndWarnings<T extends StoreAnnotation | APIAnnotation>(
  annotationsWithDatasets: Array<AnnotationInfoForAITrainingJob<T>>,
): {
  hasAnnotationErrors: boolean;
  errors: string[];
} {
  if (annotationsWithDatasets.length === 0) {
    return {
      hasAnnotationErrors: true,
      errors: ["At least one annotation must be defined."],
    };
  }
  const annotationsWithoutBoundingBoxes = annotationsWithDatasets.filter(
    ({ userBoundingBoxes }) => {
      return userBoundingBoxes.length === 0;
    },
  );
  if (annotationsWithoutBoundingBoxes.length > 0) {
    const annotationIds = annotationsWithoutBoundingBoxes.map(({ annotation }) =>
      "id" in annotation ? annotation.id : annotation.annotationId,
    );
    return {
      hasAnnotationErrors: true,
      errors: [
        `All annotations must have at least one bounding box. Annotations without bounding boxes are:\n${annotationIds.join(", ")}`,
      ],
    };
  }
  return { hasAnnotationErrors: false, errors: [] };
}

const MIN_BBOX_EXTENT_IN_EACH_DIM = 32;
export function checkBoundingBoxesForErrorsAndWarnings(
  userBoundingBoxes: (UserBoundingBox & {
    annotationId: string;
    trainingMag: Vector3 | undefined;
  })[],
): {
  hasBBoxErrors: boolean;
  hasBBoxWarnings: boolean;
  errors: string[];
  warnings: string[];
} {
  let hasBBoxErrors = false;
  let hasBBoxWarnings = false;
  const errors = [];
  const warnings = [];
  if (userBoundingBoxes.length === 0) {
    hasBBoxErrors = true;
    errors.push("At least one bounding box must be defined.");
  }
  // Find smallest bounding box dimensions
  const minDimensions = userBoundingBoxes.reduce(
    (min, { boundingBox: box, trainingMag }) => {
      let bbox = new BoundingBox(box);
      if (trainingMag) {
        bbox = bbox.alignFromMag1ToMag(trainingMag, "shrink");
      }
      const size = bbox.getSize();
      return {
        x: Math.min(min.x, size[0]),
        y: Math.min(min.y, size[1]),
        z: Math.min(min.z, size[2]),
      };
    },
    {
      x: Number.POSITIVE_INFINITY,
      y: Number.POSITIVE_INFINITY,
      z: Number.POSITIVE_INFINITY,
    },
  );

  // Validate minimum size and multiple requirements
  type BoundingBoxWithAnnotationId = {
    boundingBox: Vector6;
    name: string;
    annotationId: string;
  };
  const tooSmallBoxes: BoundingBoxWithAnnotationId[] = [];
  const nonMultipleBoxes: BoundingBoxWithAnnotationId[] = [];
  const notMagAlignedBoundingBoxes: (BoundingBoxWithAnnotationId & {
    alignedBoundingBox: Vector6;
    trainingMag: Vector3;
  })[] = [];
  userBoundingBoxes.forEach(({ boundingBox: box, name, annotationId, trainingMag }) => {
    const boundingBox = new BoundingBox(box);
    let arrayBox = computeArrayFromBoundingBox(box);
    if (trainingMag) {
      const alignedBoundingBox = boundingBox.alignFromMag1ToMag(trainingMag, "shrink");
      if (!alignedBoundingBox.equals(boundingBox)) {
        const alignedArrayBox = computeArrayFromBoundingBox(alignedBoundingBox);
        notMagAlignedBoundingBoxes.push({
          boundingBox: arrayBox,
          name,
          annotationId,
          trainingMag,
          alignedBoundingBox: alignedArrayBox,
        });
        // Update the arrayBox as the aligned version of the bounding box will be used for training.
        arrayBox = alignedArrayBox;
      }
    }
    const [_x, _y, _z, width, height, depth] = arrayBox;
    if (
      width < MIN_BBOX_EXTENT_IN_EACH_DIM ||
      height < MIN_BBOX_EXTENT_IN_EACH_DIM ||
      depth < MIN_BBOX_EXTENT_IN_EACH_DIM
    ) {
      tooSmallBoxes.push({ boundingBox: arrayBox, name, annotationId });
    }

    if (
      width % minDimensions.x !== 0 ||
      height % minDimensions.y !== 0 ||
      depth % minDimensions.z !== 0
    ) {
      nonMultipleBoxes.push({ boundingBox: arrayBox, name, annotationId });
    }
  });

  if (notMagAlignedBoundingBoxes.length > 0) {
    hasBBoxWarnings = true;
    const warningsPerAnnotation = _.toPairs(_.groupBy(notMagAlignedBoundingBoxes, "annotationId"))
      .map(([annotationId, boxes]) => {
        let warning = `- Annotation ${annotationId}\n`;
        boxes.forEach(({ name, boundingBox, alignedBoundingBox, trainingMag }) => {
          warning += `  - ${name}: ${boundingBox.join(", ")} will be ${alignedBoundingBox.join(", ")} in mag ${trainingMag.join(", ")}\n`;
        });
        return warning;
      })
      .join("\n");
    warnings.push(
      `The following bounding boxes are not aligned with the selected magnification. They will be automatically shrunk to be aligned with the magnification:\n${warningsPerAnnotation}`,
    );
  }

  const boxWithIdToString = ({ boundingBox, name, annotationId }: BoundingBoxWithAnnotationId) =>
    `'${name}' of annotation ${annotationId}: ${boundingBox.join(", ")}`;

  if (tooSmallBoxes.length > 0) {
    hasBBoxWarnings = true;
    const tooSmallBoxesStrings = tooSmallBoxes.map(boxWithIdToString);
    warnings.push(
      `The following bounding boxes are not at least ${MIN_BBOX_EXTENT_IN_EACH_DIM} Vx in each dimension which is suboptimal for the training:\n${tooSmallBoxesStrings.join("\n")}`,
    );
  }

  if (nonMultipleBoxes.length > 0) {
    hasBBoxWarnings = true;
    const nonMultipleBoxesStrings = nonMultipleBoxes.map(boxWithIdToString);
    warnings.push(
      `The minimum bounding box dimensions are ${minDimensions.x} x ${minDimensions.y} x ${minDimensions.z}. The following bounding boxes have dimensions which are not a multiple of the minimum dimensions which is suboptimal for the training:\n${nonMultipleBoxesStrings.join("\n")}`,
    );
  }

  return { hasBBoxErrors, hasBBoxWarnings, errors, warnings };
}

export const colorLayerMustNotBeUint24Rule = {
  validator: (_: Rule, value: APIDataLayer) => {
    if (value && value.elementClass === "uint24") {
      return Promise.reject(
        new Error(
          "The selected layer of type uint24 is not supported. Please select a different one.",
        ),
      );
    }
    return Promise.resolve();
  },
};

const getMagsForColorLayer = (colorLayers: APIDataLayer[], layerName: string) => {
  const colorLayer = colorLayers.find((layer) => layer.name === layerName);
  return colorLayer != null ? getMagInfo(colorLayer.mags).getMagList() : [];
};

export const getIntersectingMagList = (
  annotation: APIAnnotation,
  dataset: APIDataset,
  groundTruthLayerName: string,
  imageDataLayerName: string,
  volumeTracingMags?: { mag: Vector3 }[][],
) => {
  const colorLayers = getColorLayers(dataset);
  const dataLayerMags = getMagsForColorLayer(colorLayers, imageDataLayerName);

  let groundTruthLayerMags: Vector3[] | undefined;

  if (volumeTracingMags) {
    const volumeLayers = annotation.annotationLayers.filter((layer) => layer.typ === "Volume");
    const layerIndex = volumeLayers.findIndex((l) => l.name === groundTruthLayerName);
    if (layerIndex !== -1 && volumeTracingMags[layerIndex]) {
      groundTruthLayerMags = volumeTracingMags[layerIndex].map((m) => m.mag);
    }
  }

  if (!groundTruthLayerMags) {
    const segmentationLayer = getSegmentationLayerByHumanReadableName(
      dataset,
      annotation,
      groundTruthLayerName,
    );
    groundTruthLayerMags = getMagInfo(segmentationLayer.mags).getMagList();
  }

  return groundTruthLayerMags.filter((groundTruthMag) =>
    dataLayerMags.find((mag) => V3.equals(mag, groundTruthMag)),
  );
};
