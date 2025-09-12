import { getAnnotationsForTask } from "admin/api/tasks";
import {
  getDataset,
  getTracingForAnnotationType,
  getUnversionedAnnotationInformation,
} from "admin/rest_api";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { type APIAnnotation, AnnotationLayerEnum, type ServerVolumeTracing } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { convertUserBoundingBoxesFromServerToFrontend } from "viewer/model/reducers/reducer_helpers";
import { serverVolumeToClientVolumeTracing } from "viewer/model/reducers/volumetracing_reducer";
import type { AnnotationInfoForAITrainingJob } from "../utils";

export async function fetchAnnotationInfos(
  taskOrAnnotationIdsOrUrls: string[],
): Promise<Array<AnnotationInfoForAITrainingJob<APIAnnotation>>> {
  const annotationIdsForTraining: string[] = [];
  const unfinishedTasks: string[] = [];

  for (const taskOrAnnotationIdOrUrl of taskOrAnnotationIdsOrUrls) {
    if (taskOrAnnotationIdOrUrl.includes("/")) {
      const lastSegment = taskOrAnnotationIdOrUrl.split("/").at(-1);
      if (lastSegment) {
        annotationIdsForTraining.push(lastSegment);
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

  const newAnnotationsWithDatasets = await Promise.all(
    annotationIdsForTraining.map(async (annotationId) => {
      const annotation = await getUnversionedAnnotationInformation(annotationId);
      const dataset = await getDataset(annotation.datasetId);

      const volumeServerTracings: ServerVolumeTracing[] = await Promise.all(
        annotation.annotationLayers
          .filter((layer) => layer.typ === "Volume")
          .map(
            (layer) =>
              getTracingForAnnotationType(annotation, layer) as Promise<ServerVolumeTracing>,
          ),
      );
      const volumeTracings = volumeServerTracings.map((tracing) =>
        serverVolumeToClientVolumeTracing(tracing, null, null),
      );
      // A copy of the user bounding boxes of an annotation is saved in every tracing. In case no volume tracing exists, the skeleton tracing is checked.
      let userBoundingBoxes = volumeTracings[0]?.userBoundingBoxes;
      if (!userBoundingBoxes) {
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
        const existingIds = (userBoundingBoxes || []).map(({ id }) => id);
        const largestId = existingIds.length > 0 ? Math.max(...existingIds) : -1;
        (userBoundingBoxes || []).push({
          name: "Task Bounding Box",
          boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(annotation.task.boundingBox),
          color: [0, 0, 0],
          isVisible: true,
          id: largestId + 1,
        });
      }

      return {
        annotation,
        dataset,
        volumeTracings,
        volumeTracingMags: volumeServerTracings.map(({ mags }) =>
          mags ? mags.map(Utils.point3ToVector3) : ([[1, 1, 1]] as Vector3[]),
        ),
        userBoundingBoxes: userBoundingBoxes || [],
      };
    }),
  );
  if (unfinishedTasks.length > 0) {
    Toast.warning(
      `The following tasks have no finished annotations: ${unfinishedTasks.join(", ")}`,
    );
  }
  return newAnnotationsWithDatasets;
}
