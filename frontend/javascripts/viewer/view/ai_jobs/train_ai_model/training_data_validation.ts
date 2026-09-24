import { computeVolumeFromBoundingBox } from "libs/utils";
import type { APIAnnotation } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import {
  blockingRequirement,
  type JobRequirement,
  pendingRequirement,
  type StepStatus,
} from "../components/job_requirements";
import {
  getGroundTruthLayerBoundingBox,
  getIntersectingMagList,
  getOutOfBoundsBoundingBoxes,
} from "../utils";
import type { AiTrainingAnnotationSelection } from "./ai_training_job_context";

const MIN_BBOX_EXTENT_IN_EACH_DIM = 32;

/**
 * A problem with an annotation's bounding boxes. The summary is short enough to fit into the
 * one-line header of the annotation block; the details list e.g. the affected boxes.
 */
export type BoundingBoxIssue = { summary: string; details?: string };

export type TrainingAnnotationIssues = {
  availableMagnifications: Vector3[];
  layerError?: string;
  magnificationError?: string;
  bboxErrors: BoundingBoxIssue[];
  bboxWarnings: BoundingBoxIssue[];
};

const pluralizeBoxes = (count: number) =>
  count === 1 ? "1 bounding box" : `${count} bounding boxes`;

export const getAnnotationDisplayName = (annotation: APIAnnotation) =>
  annotation.name || annotation.id.slice(-6);

export const getTrainingVolume = (selection: AiTrainingAnnotationSelection) =>
  selection.userBoundingBoxes.reduce(
    (sum, box) => sum + computeVolumeFromBoundingBox(box.boundingBox),
    0,
  );

function getBoundingBoxIssues(
  selection: AiTrainingAnnotationSelection,
): Pick<TrainingAnnotationIssues, "bboxErrors" | "bboxWarnings"> {
  const { annotation, groundTruthLayer, magnification, userBoundingBoxes, volumeTracings } =
    selection;
  const errors: BoundingBoxIssue[] = [];
  const warnings: BoundingBoxIssue[] = [];

  if (userBoundingBoxes.length === 0) {
    errors.push({ summary: "No bounding boxes yet · add at least one" });
    return { bboxErrors: errors, bboxWarnings: warnings };
  }

  if (getTrainingVolume(selection) === 0) {
    errors.push({ summary: "Bounding boxes have a total volume of zero" });
  }

  const groundTruthLayerBoundingBox = getGroundTruthLayerBoundingBox(
    annotation,
    groundTruthLayer,
    volumeTracings,
  );
  const outOfBoundsBoxes = getOutOfBoundsBoundingBoxes(
    userBoundingBoxes,
    groundTruthLayerBoundingBox,
  );
  if (outOfBoundsBoxes.length > 0) {
    errors.push({
      summary: `${pluralizeBoxes(outOfBoundsBoxes.length)} outside the ground truth layer`,
      details: `The following bounding boxes are (partially) outside of the "${groundTruthLayer}" volume layer's bounding box and would cause the training to fail: ${outOfBoundsBoxes
        .map((box) => box.name)
        .join(", ")}`,
    });
  }

  const tooSmallBoxes: string[] = [];
  const notMagAlignedBoundingBoxes: string[] = [];

  userBoundingBoxes.forEach((box) => {
    const boundingBox = new BoundingBox(box.boundingBox);
    let effectiveBbox = boundingBox;
    if (magnification) {
      const alignedBoundingBox = boundingBox.alignFromMag1ToMag(magnification, "shrink");
      if (!alignedBoundingBox.fromMagToMag1(magnification).equals(boundingBox)) {
        notMagAlignedBoundingBoxes.push(box.name);
      }
      effectiveBbox = alignedBoundingBox;
    }

    const [width, height, depth] = effectiveBbox.getSize();
    if (
      width < MIN_BBOX_EXTENT_IN_EACH_DIM ||
      height < MIN_BBOX_EXTENT_IN_EACH_DIM ||
      depth < MIN_BBOX_EXTENT_IN_EACH_DIM
    ) {
      tooSmallBoxes.push(box.name);
    }
  });

  if (tooSmallBoxes.length > 0) {
    warnings.push({
      summary: `${pluralizeBoxes(tooSmallBoxes.length)} smaller than ${MIN_BBOX_EXTENT_IN_EACH_DIM} Vx`,
      details: `The following bounding boxes are too small. They should be at least ${MIN_BBOX_EXTENT_IN_EACH_DIM} Vx in each dimension: ${tooSmallBoxes.join(
        ", ",
      )}`,
    });
  }

  if (notMagAlignedBoundingBoxes.length > 0) {
    warnings.push({
      summary: `${pluralizeBoxes(notMagAlignedBoundingBoxes.length)} not aligned to the magnification`,
      details: `The following bounding boxes are not aligned with the selected magnification and will be automatically shrunk: ${notMagAlignedBoundingBoxes.join(
        ", ",
      )}`,
    });
  }

  return { bboxErrors: errors, bboxWarnings: warnings };
}

export function getTrainingAnnotationIssues(
  selection: AiTrainingAnnotationSelection,
): TrainingAnnotationIssues {
  const { annotation, dataset, imageDataLayer, groundTruthLayer, volumeTracingMags } = selection;

  const availableMagnifications =
    imageDataLayer && groundTruthLayer
      ? getIntersectingMagList(
          annotation,
          dataset,
          groundTruthLayer,
          imageDataLayer,
          volumeTracingMags,
        ) || []
      : [];

  const haveLayers = Boolean(imageDataLayer && groundTruthLayer);
  return {
    availableMagnifications,
    layerError:
      haveLayers && imageDataLayer === groundTruthLayer
        ? "Image Data and Ground Truth layers must be different."
        : undefined,
    magnificationError:
      haveLayers && availableMagnifications.length === 0
        ? "No common magnification found for the selected layers."
        : undefined,
    ...getBoundingBoxIssues(selection),
  };
}

export const hasTrainingAnnotationErrors = (issues: TrainingAnnotationIssues) =>
  Boolean(issues.layerError || issues.magnificationError || issues.bboxErrors.length > 0);

const isSelectionComplete = (selection: AiTrainingAnnotationSelection) =>
  Boolean(selection.imageDataLayer && selection.groundTruthLayer && selection.magnification);

function getAnnotationRequirements(selection: AiTrainingAnnotationSelection): JobRequirement[] {
  const name = getAnnotationDisplayName(selection.annotation);
  const issues = getTrainingAnnotationIssues(selection);
  const requirements: JobRequirement[] = [];

  if (!selection.imageDataLayer) {
    requirements.push(pendingRequirement(`Choose an image data layer for ${name}`));
  }
  if (!selection.groundTruthLayer) {
    requirements.push(pendingRequirement(`Choose a ground truth layer for ${name}`));
  }
  if (issues.layerError) {
    requirements.push(blockingRequirement(`Choose different layers for ${name}`));
  }
  if (issues.magnificationError) {
    requirements.push(blockingRequirement(`Choose layers with a common magnification for ${name}`));
  } else if (!selection.magnification) {
    requirements.push(pendingRequirement(`Choose a magnification for ${name}`));
  }
  if (selection.userBoundingBoxes.length === 0) {
    requirements.push(blockingRequirement(`Add bounding boxes to ${name}`));
  } else if (issues.bboxErrors.length > 0) {
    requirements.push(blockingRequirement(`Fix the bounding boxes of ${name}`));
  }
  return requirements;
}

export function getTrainingDataRequirements(
  selections: AiTrainingAnnotationSelection[],
): JobRequirement[] {
  if (selections.length === 0) {
    return [pendingRequirement("Add a training annotation")];
  }
  return selections.flatMap(getAnnotationRequirements);
}

export function getTrainingDataStepStatus(selections: AiTrainingAnnotationSelection[]): StepStatus {
  if (selections.some((s) => hasTrainingAnnotationErrors(getTrainingAnnotationIssues(s)))) {
    return "error";
  }
  return selections.length > 0 && selections.every(isSelectionComplete) ? "done" : "pending";
}
