import Request from "libs/request";
import { location } from "libs/window";
import camelCase from "lodash-es/camelCase";
import mapKeys from "lodash-es/mapKeys";
import type {
  AdditionalCoordinate,
  AiModel,
  APIAnnotationType,
  APIJob,
  RenderAnimationOptions,
} from "types/api_types";
import type { UnitLong, Vector3, Vector6 } from "viewer/constants";
import { setActiveOrganizationsCreditBalance } from "viewer/model/actions/organization_actions";
import { Store } from "viewer/singletons";
import type { SplitMergerEvaluationSettings } from "viewer/view/ai_jobs/components/collapsible_split_merger_evaluation_settings";
import { assertResponseLimit } from "./api_utils";
import { getOrganization } from "./organization";

function transformBackendJobToAPIJob(job: any): APIJob {
  return {
    ...job,
    args: mapKeys(job.args, (_value, key) => camelCase(key)),
  };
}

export async function getJobs(): Promise<APIJob[]> {
  const jobs = await Request.receiveJSON("/api/jobs");
  assertResponseLimit(jobs);
  return jobs.map(transformBackendJobToAPIJob);
}

export async function getJob(jobId: string): Promise<APIJob> {
  const job = await Request.receiveJSON(`/api/jobs/${jobId}`);
  return transformBackendJobToAPIJob(job);
}

export async function cancelJob(jobId: string): Promise<APIJob> {
  return Request.receiveJSON(`/api/jobs/${jobId}/cancel`, {
    method: "PATCH",
  });
}

export type JobCreditCostInfo = {
  costInMilliCredits: number;
  hasEnoughCredits: boolean;
  // The organizations credits used during calculation whether the organization has enough credits for the job.
  organizationMilliCredits: number;
};

async function getJobCreditCost(
  command: string,
  boundingBoxInMag: Vector6,
): Promise<JobCreditCostInfo> {
  const params = new URLSearchParams({
    command,
    boundingBoxInMag: boundingBoxInMag.join(","),
  });
  return await Request.receiveJSON(`/api/jobs/getCreditCost?${params}`);
}

export async function getJobCreditCostAndUpdateOrgaCredits(
  command: string,
  boundingBoxInMag: Vector6,
): Promise<JobCreditCostInfo> {
  const jobCreditCostInfo = await getJobCreditCost(command, boundingBoxInMag);
  Store.dispatch(setActiveOrganizationsCreditBalance(jobCreditCostInfo.organizationMilliCredits));
  return jobCreditCostInfo;
}

export async function refreshOrganizationCredits() {
  const organizationId = Store.getState().activeOrganization?.id;
  if (organizationId) {
    const orga = await getOrganization(organizationId);
    if (orga.milliCreditBalance != null) {
      Store.dispatch(setActiveOrganizationsCreditBalance(orga.milliCreditBalance));
    }
  }
}

export async function retryJob(jobId: string): Promise<APIJob> {
  return Request.receiveJSON(`/api/jobs/${jobId}/retry`, {
    method: "PATCH",
  });
}

export async function startConvertToWkwJob(
  datasetId: string,
  scale: Vector3,
  unit: UnitLong,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/convertToWkw/${datasetId}?scale=${scale.toString()}&unit=${unit}`,
    {
      method: "POST",
    },
  );
}

export async function startFindLargestSegmentIdJob(
  datasetId: string,
  layerName: string,
): Promise<APIJob> {
  return Request.receiveJSON(
    `/api/jobs/run/findLargestSegmentId/${datasetId}?layerName=${layerName}`,
    {
      method: "POST",
    },
  );
}

export async function startExportTiffJob(
  datasetId: string,
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
  return Request.receiveJSON(`/api/jobs/run/exportTiff/${datasetId}?${params}`, {
    method: "POST",
  });
}

export function startComputeMeshFileJob(
  datasetId: string,
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

  return Request.receiveJSON(`/api/jobs/run/computeMeshFile/${datasetId}?${params}`, {
    method: "POST",
  });
}

export function startComputeSegmentIndexFileJob(
  datasetId: string,
  layerName: string,
): Promise<APIJob> {
  const params = new URLSearchParams();
  params.append("layerName", layerName);

  return Request.receiveJSON(`/api/jobs/run/computeSegmentIndexFile/${datasetId}?${params}`, {
    method: "POST",
  });
}

export function runPretrainedNucleiInferenceJob(
  datasetId: string,
  layerName: string,
  newDatasetName: string,
  invertColorLayer: boolean,
): Promise<APIJob> {
  const urlParams = new URLSearchParams({
    layerName,
    newDatasetName,
    invertColorLayer: invertColorLayer.toString(),
  });
  return Request.receiveJSON(`/api/jobs/run/inferNuclei/${datasetId}?${urlParams.toString()}`, {
    method: "POST",
  });
}

export function runPretrainedNeuronInferenceJob(
  datasetId: string,
  layerName: string,
  bbox: Vector6,
  newDatasetName: string,
  invertColorLayer: boolean,
  doSplitMergerEvaluation: boolean,
  annotationId?: string,
  splitMergerEvaluationSettings?: SplitMergerEvaluationSettings,
): Promise<APIJob> {
  const urlParams = new URLSearchParams({
    layerName,
    bbox: bbox.join(","),
    newDatasetName,
    doSplitMergerEvaluation: doSplitMergerEvaluation.toString(),
    invertColorLayer: invertColorLayer.toString(),
  });
  if (doSplitMergerEvaluation) {
    if (!annotationId) {
      throw new Error("annotationId is required when doSplitMergerEvaluation is true");
    }
    urlParams.append("annotationId", `${annotationId}`);
    if (splitMergerEvaluationSettings != null) {
      const {
        useSparseTracing,
        maxEdgeLength,
        sparseTubeThresholdInNm,
        minimumMergerPathLengthInNm,
      } = splitMergerEvaluationSettings;
      if (useSparseTracing != null) {
        urlParams.append("evalUseSparseTracing", `${useSparseTracing}`);
      }
      if (maxEdgeLength != null) {
        urlParams.append("evalMaxEdgeLength", `${maxEdgeLength}`);
      }
      if (sparseTubeThresholdInNm != null) {
        urlParams.append("evalSparseTubeThresholdNm", `${sparseTubeThresholdInNm}`);
      }
      if (minimumMergerPathLengthInNm != null) {
        urlParams.append("evalMinMergerPathLengthNm", `${minimumMergerPathLengthInNm}`);
      }
    }
  }
  return Request.receiveJSON(`/api/jobs/run/inferNeurons/${datasetId}?${urlParams.toString()}`, {
    method: "POST",
  });
}

export function startRenderAnimationJob(
  datasetId: string,
  animationOptions: RenderAnimationOptions,
): Promise<APIJob> {
  return Request.sendJSONReceiveJSON(`/api/jobs/run/renderAnimation/${datasetId}`, {
    data: animationOptions,
  });
}

function startSegmentationAnnotationDependentJob(
  jobURLPath: string,
  datasetId: string,
  fallbackLayerName: string,
  volumeLayerName: string | null | undefined,
  newDatasetName: string,
  annotationId: string,
  annotationType: APIAnnotationType,
  mergeSegments?: boolean,
  includesEditableMapping?: boolean,
  boundingBox?: Vector6,
): Promise<APIJob> {
  const requestURL = new URL(`/api/jobs/run/${jobURLPath}/${datasetId}`, location.origin);
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
  if (includesEditableMapping != null) {
    requestURL.searchParams.append("includesEditableMapping", includesEditableMapping.toString());
  }
  if (boundingBox) {
    requestURL.searchParams.append("boundingBox", boundingBox.join(","));
  }
  return Request.receiveJSON(requestURL.href, {
    method: "POST",
  });
}

export function startMaterializingVolumeAnnotationJob(
  datasetId: string,
  fallbackLayerName: string,
  volumeLayerName: string | null | undefined,
  newDatasetName: string,
  annotationId: string,
  annotationType: APIAnnotationType,
  mergeSegments: boolean,
  includesEditableMapping: boolean,
  boundingBox?: Vector6,
): Promise<APIJob> {
  return startSegmentationAnnotationDependentJob(
    "materializeVolumeAnnotation",
    datasetId,
    fallbackLayerName,
    volumeLayerName,
    newDatasetName,
    annotationId,
    annotationType,
    mergeSegments,
    includesEditableMapping,
    boundingBox,
  );
}

export function runPretrainedMitochondriaInferenceJob(
  datasetId: string,
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
    `/api/jobs/run/inferMitochondria/${datasetId}?${urlParams.toString()}`,
    {
      method: "POST",
    },
  );
}

export function startAlignSectionsJob(
  datasetId: string,
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
  return Request.receiveJSON(`/api/jobs/run/alignSections/${datasetId}?${urlParams.toString()}`, {
    method: "POST",
  });
}

// This enum needs to be kept in sync with the backend/database
export enum APIAiModelCategory {
  EM_NEURONS = "em_neurons",
  EM_NUCLEI = "em_nuclei",
}

export type AiModelTrainingAnnotationSpecification = {
  annotationId: string;
  colorLayerName: string;
  segmentationLayerName: string;
  mag: Vector3;
};

type RunNeuronModelTrainingParameters = {
  trainingAnnotations: AiModelTrainingAnnotationSpecification[];
  name: string;
  aiModelCategory: APIAiModelCategory.EM_NEURONS;
  comment?: string;
  workflowYaml?: string;
};

export function runNeuronTraining(params: RunNeuronModelTrainingParameters) {
  return Request.sendJSONReceiveJSON("/api/aiModels/runNeuronModelTraining", {
    method: "POST",
    data: JSON.stringify(params),
  });
}

type RunInstanceModelTrainingParameters = {
  trainingAnnotations: AiModelTrainingAnnotationSpecification[];
  name: string;
  aiModelCategory: APIAiModelCategory.EM_NUCLEI;
  instanceDiameterNm: number;
  comment?: string;
  workflowYaml?: string;
};

export function runInstanceModelTraining(params: RunInstanceModelTrainingParameters) {
  return Request.sendJSONReceiveJSON("/api/aiModels/runInstanceModelTraining", {
    method: "POST",
    data: JSON.stringify(params),
  });
}

export type BaseCustomModelInferenceParameters = {
  annotationId?: string;
  aiModelId: string;
  datasetDirectoryName: string;
  organizationId: string;
  colorLayerName: string;
  boundingBox: Vector6;
  newDatasetName: string;
  workflowYaml?: string;
  invertColorLayer: boolean;
  // maskAnnotationLayerName?: string | null
};
type RunCustomNeuronModelInferenceParameters = BaseCustomModelInferenceParameters;

type RunCustomInstanceModelInferenceParameters = BaseCustomModelInferenceParameters & {
  seedGeneratorDistanceThreshold: number | null;
};

export function runCustomNeuronModelInferenceJob(params: RunCustomNeuronModelInferenceParameters) {
  return Request.sendJSONReceiveJSON("/api/aiModels/inferences/runCustomNeuronModelInference", {
    method: "POST",
    data: JSON.stringify({ ...params, boundingBox: params.boundingBox.join(",") }),
  });
}

export function runCustomInstanceModelInferenceJob(
  params: RunCustomInstanceModelInferenceParameters,
) {
  return Request.sendJSONReceiveJSON("/api/aiModels/inferences/runCustomInstanceModelInference", {
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

export async function updateAiModel(aiModel: AiModel) {
  return Request.sendJSONReceiveJSON(`/api/aiModels/${aiModel.id}`, {
    method: "PUT",
    data: {
      name: aiModel.name,
      comment: aiModel.comment,
      sharedOrganizationIds: aiModel.sharedOrganizationIds,
    },
  });
}
