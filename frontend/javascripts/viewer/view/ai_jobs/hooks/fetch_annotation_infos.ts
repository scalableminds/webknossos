import { getAnnotationsForTask } from "admin/api/tasks";
import {
  getDataset,
  getShortLink,
  getTracingForAnnotationType,
  getUnversionedAnnotationInformation,
} from "admin/rest_api";
import Toast from "libs/toast";
import { computeBoundingBoxFromBoundingBoxObject, point3ToVector3 } from "libs/utils";
import { AnnotationLayerEnum, type APIAnnotation, type ServerVolumeTracing } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { convertUserBoundingBoxesFromServerToFrontend } from "viewer/model/reducers/reducer_helpers";
import { serverVolumeToClientVolumeTracing } from "viewer/model/reducers/volumetracing_reducer";
import type { VolumeTracing } from "viewer/store";
import type { AnnotationInfoForAITrainingJob } from "../utils";

/**
 * Extracts the key of a short link (e.g. https://webknossos.org/links/PXF4yaASqFQm3YIt) from a string,
 * or returns null if the string is not a short link URL.
 */
function extractShortLinkKey(taskOrAnnotationIdOrUrl: string): string | null {
  try {
    const url = new URL(taskOrAnnotationIdOrUrl);
    const match = url.pathname.match(/^\/links\/([^/]+)\/?$/);
    return match ? match[1] : null;
  } catch (_e) {
    return null;
  }
}

/**
 * Parses a list of task IDs, annotation IDs, or annotation URLs (including short links) and sorts
 * them into annotation IDs for training and unfinished tasks.
 * @returns An object containing the annotation IDs for training, a list of unfinished tasks and a list of short links that could not be resolved.
 */
async function resolveAnnotationIds(taskOrAnnotationIdsOrUrls: string[]): Promise<{
  annotationIdsForTraining: string[];
  unfinishedTasks: string[];
  unresolvedShortLinks: string[];
}> {
  const annotationIdsForTraining: string[] = [];
  const unfinishedTasks: string[] = [];
  const unresolvedShortLinks: string[] = [];

  for (const original of taskOrAnnotationIdsOrUrls) {
    let taskOrAnnotationIdOrUrl = original;
    const shortLinkKey = extractShortLinkKey(taskOrAnnotationIdOrUrl);
    if (shortLinkKey != null) {
      try {
        const shortLink = await getShortLink(shortLinkKey);
        taskOrAnnotationIdOrUrl = shortLink.longLink;
      } catch (_e) {
        unresolvedShortLinks.push(original);
        continue;
      }
    }

    if (taskOrAnnotationIdOrUrl.includes("/")) {
      // Resolved short links may carry a #-prefixed URL fragment (encoding the view state),
      // so the annotation ID is extracted from the pathname only, ignoring hash/query parts.
      let pathname = taskOrAnnotationIdOrUrl;
      try {
        pathname = new URL(taskOrAnnotationIdOrUrl).pathname;
      } catch (_e) {
        // Not an absolute URL (e.g. a relative path) -- fall back to the raw string.
      }
      const annotationId = pathname.split("/").at(-1);
      if (annotationId) {
        annotationIdsForTraining.push(annotationId);
      }
    } else {
      let isTask = true;
      try {
        const annotations = await getAnnotationsForTask(taskOrAnnotationIdOrUrl, {
          showErrorToast: false,
        });
        const finishedAnnotations = annotations.filter(({ state }) => state === "Finished");
        if (finishedAnnotations.length > 0) {
          annotationIdsForTraining.push(...finishedAnnotations.map(({ id }) => id));
        } else {
          unfinishedTasks.push(taskOrAnnotationIdOrUrl);
        }
      } catch (_e) {
        isTask = false;
      }
      if (!isTask) {
        annotationIdsForTraining.push(taskOrAnnotationIdOrUrl);
      }
    }
  }
  return { annotationIdsForTraining, unfinishedTasks, unresolvedShortLinks };
}

/**
 * Fetches volume tracings for a given annotation.
 * @returns A promise that resolves to an array of server volume tracings.
 */
async function getVolumeServerTracings(annotation: APIAnnotation): Promise<ServerVolumeTracing[]> {
  return await Promise.all(
    annotation.annotationLayers
      .filter((layer) => layer.typ === "Volume")
      .map(
        (layer) => getTracingForAnnotationType(annotation, layer) as Promise<ServerVolumeTracing>,
      ),
  );
}

/**
 * Extracts magnification information from server volume tracings.
 * @returns An object mapping layer names to their magnification information.
 */
function getVolumeTracingMags(
  annotation: APIAnnotation,
  volumeServerTracings: ServerVolumeTracing[],
) {
  const volumeLayers = annotation.annotationLayers.filter((layer) => layer.typ === "Volume");
  const volumeTracingMags: Record<string, { mag: Vector3 }[]> = {};

  volumeServerTracings.forEach((tracing) => {
    const layer = volumeLayers.find((l) => l.tracingId === tracing.id);

    if (layer) {
      volumeTracingMags[layer.name] = tracing.mags
        ? tracing.mags.map((mag) => ({ mag: point3ToVector3(mag) }))
        : [{ mag: [1, 1, 1] as Vector3 }];
    }
  });
  return volumeTracingMags;
}

/**
 * Get user bounding boxes for an annotation, falling back to skeleton layer if needed.
 * Also includes the task bounding box if available.
 * @returns A promise that resolves to an array of user bounding boxes.
 */
async function getBoundingBoxes(
  annotation: APIAnnotation,
  volumeTracings: VolumeTracing[],
): Promise<any[]> {
  // A copy of the user bounding boxes of an annotation is saved in every tracing. In case no volume tracing exists, the skeleton tracing is checked.
  let userBoundingBoxes = volumeTracings[0]?.userBoundingBoxes ?? [];
  if (userBoundingBoxes.length === 0) {
    // The original code had a bug here (!userBoundingBoxes) which was always false for an empty array.
    const skeletonLayer = annotation.annotationLayers.find(
      (layer) => layer.typ === AnnotationLayerEnum.Skeleton,
    );
    if (skeletonLayer) {
      const skeletonTracing = await getTracingForAnnotationType(annotation, skeletonLayer);
      userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(
        skeletonTracing.userBoundingBoxes,
        undefined,
      );
    } else {
      throw new Error(`Annotation ${annotation.id} has neither a volume nor a skeleton layer`);
    }
  }

  if (annotation.task?.boundingBox) {
    const existingIds = userBoundingBoxes.map(({ id }) => id);
    const largestId = existingIds.length > 0 ? Math.max(...existingIds) : -1;
    userBoundingBoxes.push({
      name: "Task Bounding Box",
      boundingBox: computeBoundingBoxFromBoundingBoxObject(annotation.task.boundingBox),
      color: [0, 0, 0],
      isVisible: true,
      id: largestId + 1,
    });
  }
  return userBoundingBoxes;
}

/**
 * Fetches all necessary information for a single annotation to be used in an AI training job.
 * @param annotationId - The ID of the annotation to fetch information for.
 * @returns A promise that resolves to an object containing all necessary annotation information.
 */
export async function fetchAnnotationInfo(
  annotationId: string,
): Promise<AnnotationInfoForAITrainingJob<APIAnnotation>> {
  const annotation = await getUnversionedAnnotationInformation(annotationId, {
    showErrorToast: false,
  });
  const dataset = await getDataset(annotation.datasetId);

  const volumeServerTracings = await getVolumeServerTracings(annotation);
  const volumeTracings = volumeServerTracings.map((tracing) =>
    serverVolumeToClientVolumeTracing(tracing, null, null),
  );

  const userBoundingBoxes = await getBoundingBoxes(annotation, volumeTracings);
  const volumeTracingMags = getVolumeTracingMags(annotation, volumeServerTracings);

  return {
    annotation,
    dataset,
    volumeTracings,
    volumeTracingMags,
    userBoundingBoxes,
  };
}

/**
 * Fetches all necessary information for a list of tasks or annotations to be used in an AI training job.
 * It resolves task IDs to annotation IDs, fetches details for each annotation, and shows a warning for tasks with no finished annotations.
 * @param taskOrAnnotationIdsOrUrls - A list of task IDs, annotation IDs, or annotation URLs (short links are resolved automatically).
 * @returns A promise that resolves to an array of objects, each containing all necessary annotation information.
 */
export async function fetchAnnotationInfos(
  taskOrAnnotationIdsOrUrls: string[],
): Promise<AnnotationInfoForAITrainingJob<APIAnnotation>[]> {
  try {
    const { annotationIdsForTraining, unfinishedTasks, unresolvedShortLinks } =
      await resolveAnnotationIds(taskOrAnnotationIdsOrUrls);

    const newAnnotationsWithDatasets = await Promise.all(
      annotationIdsForTraining.map(fetchAnnotationInfo),
    );
    if (unfinishedTasks.length > 0) {
      Toast.warning(
        `The following tasks have no finished annotations: ${unfinishedTasks.join(", ")}`,
      );
    }
    if (unresolvedShortLinks.length > 0) {
      Toast.error(
        `The following short links could not be resolved: ${unresolvedShortLinks.join(", ")}`,
      );
    }
    return newAnnotationsWithDatasets;
  } catch (error) {
    console.error("Failed to fetch annotation information:", error);
    Toast.error(
      "An error occurred while fetching annotation information. See console for details.",
    );
    return [];
  }
}
