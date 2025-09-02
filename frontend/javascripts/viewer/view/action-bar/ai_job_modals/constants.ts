import { APIJobType } from "types/api_types";
import type { Vector3 } from "viewer/constants";

export type StartAiJobDrawerState =
  | "open_ai_training"
  | "open_ai_inference"
  | "open_ai_alignment"
  | "invisible";

// "materialize_volume_annotation" is only used in this module
export const jobNameToImagePath = {
  infer_neurons: "neuron_inferral_example.jpg",
  infer_nuclei: "nuclei_inferral_example.jpg",
  infer_mitochondria: "mito_inferral_example.jpg",
  align_sections: "align_example.png",
  materialize_volume_annotation: "materialize_volume_annotation_example.jpg",
  invisible: "",
  infer_with_model: "",
} as const;

// The following minimal bounding box extents and mean voxel sizes are based on the default model that is used for neuron and mitochondria segmentation.
// Thus when changing the default model, consider changing these values as well.
// See https://github.com/scalableminds/webknossos/issues/8198#issuecomment-2782684436
export const MIN_BBOX_EXTENT: Record<APIJobType, Vector3> = {
  [APIJobType.INFER_NEURONS]: [16, 16, 4],
  [APIJobType.INFER_NUCLEI]: [4, 4, 4],
  [APIJobType.INFER_MITOCHONDRIA]: [4, 4, 4],
};

export const MEAN_VX_SIZE: Record<APIJobType.INFER_NEURONS | APIJobType.INFER_NUCLEI, Vector3> = {
  infer_neurons: [7.96, 7.96, 31.2],
  infer_nuclei: [179.84, 179.84, 224.0],
  // "infer_mitochondria" infers on finest available mag
};
