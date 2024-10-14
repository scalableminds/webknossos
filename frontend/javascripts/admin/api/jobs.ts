import Request from "libs/request";
import { location } from "libs/window";
import type { UnitLong, Vector3, Vector6 } from "oxalis/constants";
import type {
  APIAnnotationType,
  APIJob,
  APIJobState,
  APIJobManualState,
  APIEffectiveJobState,
  AiModel,
  RenderAnimationOptions,
  AdditionalCoordinate,
} from "types/api_flow_types";
import { assertResponseLimit } from "./api_utils";

function transformBackendJobToAPIJob(job: any): APIJob {
  return {
    id: job.id,
    owner: job.owner,
    type: job.command,
    datasetName: job.commandArgs.dataset_name,
    organizationId: job.commandArgs.organization_name,
    layerName: job.commandArgs.layer_name || job.commandArgs.volume_layer_name,
    annotationLayerName: job.commandArgs.annotation_layer_name,
    boundingBox: job.commandArgs.bbox,
    ndBoundingBox: job.commandArgs.nd_bbox,
    exportFileName: job.commandArgs.export_file_name,
    tracingId: job.commandArgs.volume_tracing_id,
    annotationId: job.commandArgs.annotation_id,
    annotationType: job.commandArgs.annotation_type,
    mergeSegments: job.commandArgs.merge_segments,
    trainingAnnotations: job.commandArgs.training_annotations,
    state: adaptJobState(job.state, job.manualState),
    manualState: job.manualState,
    result: job.returnValue,
    resultLink: job.resultLink,
    createdAt: job.created,
    voxelyticsWorkflowHash: job.voxelyticsWorkflowHash,
  };
}

export async function getJobs(): Promise<APIJob[]> {
  const jobs = await Request.receiveJSON("/api/jobs");
  assertResponseLimit(jobs);
  return (
    jobs
      .map(transformBackendJobToAPIJob)
      // Newest jobs should be first
      .sort((a: APIJob, b: APIJob) => a.createdAt > b.createdAt)
  );
}

export async function getJob(jobId: string): Promise<APIJob> {
  const job = await Request.receiveJSON(`/api/jobs/${jobId}`);
  return transformBackendJobToAPIJob(job);
}

function adaptJobState(
  celeryState: APIJobState,
  manualState: APIJobManualState,
): APIEffectiveJobState {
  if (manualState) {
    return manualState;
  }

  return celeryState || "UNKNOWN";
}

export async function cancelJob(jobId: string): Promise<APIJob> {
  return Request.receiveJSON(`/api/jobs/${jobId}/cancel`, {
    method: "PATCH",
  });
}

export async function startConvertToWkwJob(
  datasetName: string,
  organizationId: string,
  scale: Vector3,
  unit: UnitLong,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/convertToWkw/${organizationId}/${datasetName}?scale=${scale.toString()}&unit=${unit}`,
    {
      method: "POST",
    },
  );
}

export async function startFindLargestSegmentIdJob(
  datasetName: string,
  organizationId: string,
  layerName: string,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/findLargestSegmentId/${organizationId}/${datasetName}?layerName=${layerName}`,
    {
      method: "POST",
    },
  );
}

export async function startExportTiffJob(
  datasetName: string,
  organizationId: string,
  bbox: Vector6,
  additionalCoordinates: AdditionalCoordinate[] | null,
  layerName: string | null | undefined,
  mag: string | null | undefined,
  annotationId: string | null | undefined,
  annotationLayerName: string | null | undefined,
  asOmeTiff: boolean,
): Promise<APIJob> {
  const params = new URLSearchParams({ bbox: bbox.join(","), asOmeTiff: asOmeTiff.toString() });
  if (layerName != null) {
    params.append("layerName", layerName);
  }
  if (mag != null) {
    params.append("mag", mag);
  }
  if (annotationId != null) {
    params.append("annotationId", annotationId);
  }
  if (annotationLayerName != null) {
    params.append("annotationLayerName", annotationLayerName);
  }
  if (additionalCoordinates != null) {
    params.append("additionalCoordinates", JSON.stringify(additionalCoordinates));
  }
  return Request.receiveJSON(
    `/api/jobs/run/exportTiff/${organizationId}/${datasetName}?${params}`,
    {
      method: "POST",
    },
  );
}

export function startComputeMeshFileJob(
  organizationId: string,
  datasetName: string,
  layerName: string,
  mag: Vector3,
  agglomerateView?: string,
): Promise<APIJob> {
  const params = new URLSearchParams();
  params.append("layerName", layerName);
  params.append("mag", mag.join("-"));

  if (agglomerateView) {
    params.append("agglomerateView", agglomerateView);
  }

  return Request.receiveJSON(
    `/api/jobs/run/computeMeshFile/${organizationId}/${datasetName}?${params}`,
    {
      method: "POST",
    },
  );
}

export function startComputeSegmentIndexFileJob(
  organizationId: string,
  datasetName: string,
  layerName: string,
): Promise<APIJob> {
  const params = new URLSearchParams();
  params.append("layerName", layerName);

  return Request.receiveJSON(
    `/api/jobs/run/computeSegmentIndexFile/${organizationId}/${datasetName}?${params}`,
    {
      method: "POST",
    },
  );
}

export function startNucleiInferralJob(
  organizationId: string,
  datasetName: string,
  layerName: string,
  newDatasetName: string,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/inferNuclei/${organizationId}/${datasetName}?layerName=${layerName}&newDatasetName=${newDatasetName}`,
    {
      method: "POST",
    },
  );
}

export function startNeuronInferralJob(
  organizationId: string,
  datasetName: string,
  layerName: string,
  bbox: Vector6,
  newDatasetName: string,
): Promise<APIJob> {
  const urlParams = new URLSearchParams({
    layerName,
    bbox: bbox.join(","),
    newDatasetName,
  });
  return Request.receiveJSON(
    `/api/jobs/run/inferNeurons/${organizationId}/${datasetName}?${urlParams.toString()}`,
    {
      method: "POST",
    },
  );
}

export function startRenderAnimationJob(
  organizationId: string,
  datasetName: string,
  animationOptions: RenderAnimationOptions,
): Promise<APIJob> {
  return Request.sendJSONReceiveJSON(
    `/api/jobs/run/renderAnimation/${organizationId}/${datasetName}`,
    {
      data: animationOptions,
    },
  );
}

function startSegmentationAnnotationDependentJob(
  jobURLPath: string,
  organizationId: string,
  datasetName: string,
  fallbackLayerName: string,
  volumeLayerName: string | null | undefined,
  newDatasetName: string,
  annotationId: string,
  annotationType: APIAnnotationType,
  mergeSegments?: boolean,
): Promise<APIJob> {
  const requestURL = new URL(
    `/api/jobs/run/${jobURLPath}/${organizationId}/${datasetName}`,
    location.origin,
  );
  if (volumeLayerName != null) {
    requestURL.searchParams.append("volumeLayerName", volumeLayerName);
  }
  const layerName = volumeLayerName || fallbackLayerName;
  requestURL.searchParams.append("fallbackLayerName", fallbackLayerName);
  requestURL.searchParams.append("annotationId", annotationId);
  requestURL.searchParams.append("annotationType", annotationType);
  requestURL.searchParams.append("newDatasetName", newDatasetName);
  requestURL.searchParams.append("outputSegmentationLayerName", `${layerName}_materialized`);
  if (mergeSegments != null) {
    requestURL.searchParams.append("mergeSegments", mergeSegments.toString());
  }
  return Request.receiveJSON(requestURL.href, {
    method: "POST",
  });
}

export function startMaterializingVolumeAnnotationJob(
  organizationId: string,
  datasetName: string,
  fallbackLayerName: string,
  volumeLayerName: string | null | undefined,
  newDatasetName: string,
  annotationId: string,
  annotationType: APIAnnotationType,
  mergeSegments: boolean,
): Promise<APIJob> {
  return startSegmentationAnnotationDependentJob(
    "materializeVolumeAnnotation",
    organizationId,
    datasetName,
    fallbackLayerName,
    volumeLayerName,
    newDatasetName,
    annotationId,
    annotationType,
    mergeSegments,
  );
}

export function startMitochondriaInferralJob(
  organizationId: string,
  datasetName: string,
  layerName: string,
  bbox: Vector6,
  newDatasetName: string,
): Promise<APIJob> {
  const urlParams = new URLSearchParams({
    layerName,
    bbox: bbox.join(","),
    newDatasetName,
  });
  return Request.receiveJSON(
    `/api/jobs/run/inferMitochondria/${organizationId}/${datasetName}?${urlParams.toString()}`,
    {
      method: "POST",
    },
  );
}

export function startAlignSectionsJob(
  organizationId: string,
  datasetName: string,
  layerName: string,
  newDatasetName: string,
  annotationId?: string,
): Promise<APIJob> {
  const urlParams = annotationId
    ? new URLSearchParams({
        layerName,
        newDatasetName,
        annotationId,
      })
    : new URLSearchParams({
        layerName,
        newDatasetName,
      });
  return Request.receiveJSON(
    `/api/jobs/run/alignSections/${organizationId}/${datasetName}?${urlParams.toString()}`,
    {
      method: "POST",
    },
  );
}

type AiModelCategory = "em_neurons" | "em_nuclei";

type AiModelTrainingAnnotationSpecification = {
  annotationId: string;
  colorLayerName: string;
  segmentationLayerName: string;
  mag: Vector3;
};

type RunTrainingParameters = {
  trainingAnnotations: Array<AiModelTrainingAnnotationSpecification>;
  name: string;
  comment?: string;
  aiModelCategory?: AiModelCategory;
  workflowYaml?: string;
};

export function runTraining(params: RunTrainingParameters) {
  return Request.sendJSONReceiveJSON("/api/aiModels/runTraining", {
    method: "POST",
    data: JSON.stringify(params),
  });
}

type RunInferenceParameters = {
  annotationId?: string;
  aiModelId: string;
  datasetName: string;
  colorLayerName: string;
  boundingBox: Vector6;
  newDatasetName: string;
  workflowYaml?: string;
  // maskAnnotationLayerName?: string | null
};

export function runInferenceJob(params: RunInferenceParameters) {
  return Request.sendJSONReceiveJSON("/api/aiModels/inferences/runInference", {
    method: "POST",
    data: JSON.stringify({ ...params, boundingBox: params.boundingBox.join(",") }),
  });
}

export async function getAiModels(): Promise<AiModel[]> {
  const models = await Request.receiveJSON("/api/aiModels");
  return models.map((model: any) => ({
    ...model,
    trainingJob: model.trainingJob == null ? null : transformBackendJobToAPIJob(model.trainingJob),
  }));
}
