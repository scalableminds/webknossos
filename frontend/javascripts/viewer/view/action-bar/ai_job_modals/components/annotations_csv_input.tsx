import React, { useState } from "react";
import { getAnnotationsForTask } from "admin/api/tasks";
import {
  getDataset,
  getTracingForAnnotationType,
  getUnversionedAnnotationInformation,
} from "admin/rest_api";
import { Button, Form, Input } from "antd";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { type APIAnnotation, AnnotationLayerEnum, type ServerVolumeTracing } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { convertUserBoundingBoxesFromServerToFrontend } from "viewer/model/reducers/reducer_helpers";
import { serverVolumeToClientVolumeTracing } from "viewer/model/reducers/volumetracing_reducer";
import type { AnnotationInfoForAITrainingJob } from "../utils";

const { TextArea } = Input;

export function AnnotationsCsvInput({
  onAdd,
}: { onAdd: (newItems: Array<AnnotationInfoForAITrainingJob<APIAnnotation>>) => void }) {
  const [value, setValue] = useState("");
  const onClickAdd = async () => {
    const annotationIdsForTraining = [];
    const unfinishedTasks = [];

    const lines = value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    for (const taskOrAnnotationIdOrUrl of lines) {
      if (taskOrAnnotationIdOrUrl.includes("/")) {
        annotationIdsForTraining.push(taskOrAnnotationIdOrUrl.split("/").at(-1) as string);
      } else {
        let isTask = true;
        try {
          const annotations = await getAnnotationsForTask(taskOrAnnotationIdOrUrl, {
            showErrorToast: false,
          });
          const finishedAnnotations = annotations.filter(({ state }) => state === "Finished");
          if (annotations.length > 0) {
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
            throw new Error(
              `Annotation ${annotation.id} has neither a volume nor a skeleton layer`,
            );
          }
        }
        if (annotation.task?.boundingBox) {
          const largestId = Math.max(...userBoundingBoxes.map(({ id }) => id));
          userBoundingBoxes.push({
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
    onAdd(newAnnotationsWithDatasets);
  };
  return (
    <div>
      <Form.Item
        name="annotationCsv"
        label="Annotations or Tasks CSV"
        hasFeedback
        initialValue={value}
        rules={[
          () => ({
            validator: (_rule, value) => {
              const valid = (value as string)
                .split("\n")
                .every((line) => !line.includes("#") && !line.includes(","));

              return valid
                ? Promise.resolve()
                : Promise.reject(
                    new Error(
                      "Each line should only contain an annotation ID or URL (without # or ,)",
                    ),
                  );
            },
          }),
        ]}
      >
        <TextArea
          className="input-monospace"
          placeholder="taskOrAnnotationIdOrUrl"
          autoSize={{
            minRows: 6,
          }}
          style={{
            fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
          }}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </Form.Item>
      <Button type="primary" onClick={onClickAdd}>
        Add
      </Button>
    </div>
  );
}
