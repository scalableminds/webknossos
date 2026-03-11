import alignExample from "@images/align-example.png";
import materializeVolumeAnnotationExample from "@images/materialize-volume-annotation-example.jpg";
import mitoInferralExample from "@images/mito-inferral-example.jpg";
import neuronInferralExample from "@images/neuron-inferral-example.jpg";
import nucleiInferralExample from "@images/nuclei-inferral-example.jpg";
import { APIJobCommand } from "types/api_types";
import type { Vector3 } from "viewer/constants";

export type StartAiJobDrawerState =
  | "open_ai_training"
  | "open_ai_inference"
  | "open_ai_alignment"
  | "invisible";

// "materialize_volume_annotation" is only used in this module
export const jobNameToImagePath = {
  infer_neurons: neuronInferralExample,
  infer_nuclei: nucleiInferralExample,
  infer_mitochondria: mitoInferralExample,
  align_sections: alignExample,
  materialize_volume_annotation: materializeVolumeAnnotationExample,
  invisible: "",
  infer_with_model: "",
} as const;

// The following minimal bounding box extents and mean voxel sizes are based on the default model that is used for neuron and mitochondria segmentation.
// Thus when changing the default model, consider changing these values as well.
// See https://github.com/scalableminds/webknossos/issues/8198#issuecomment-2782684436
export const MIN_BBOX_EXTENT: Record<
  | APIJobCommand.INFER_NEURONS
  | APIJobCommand.INFER_NUCLEI
  | APIJobCommand.INFER_MITOCHONDRIA
  | APIJobCommand.INFER_INSTANCES,
  Vector3
> = {
  [APIJobCommand.INFER_NEURONS]: [16, 16, 4],
  [APIJobCommand.INFER_NUCLEI]: [4, 4, 4],
  [APIJobCommand.INFER_INSTANCES]: [4, 4, 4],
  [APIJobCommand.INFER_MITOCHONDRIA]: [4, 4, 4],
};

export const MEAN_VX_SIZE: Record<
  APIJobCommand.INFER_NEURONS | APIJobCommand.INFER_NUCLEI,
  Vector3
> = {
  infer_neurons: [7.96, 7.96, 31.2],
  infer_nuclei: [179.84, 179.84, 224.0],
  // "infer_mitochondria" infers on finest available mag
};
