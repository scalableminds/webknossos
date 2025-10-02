import { Alert, Row } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback } from "react";
import { getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { getSomeTracing } from "viewer/model/accessors/tracing_accessor";
import { getSegmentationLayerByHumanReadableName } from "viewer/model/accessors/volumetracing_accessor";
import { Model } from "viewer/singletons";
import { TrainAiModelForm } from "../forms/train_ai_model_form";

export function TrainAiModelFromAnnotationTab({ onClose }: { onClose: () => void }) {
  const annotation = useWkSelector((state) => state.annotation);
  const dataset = useWkSelector((state) => state.dataset);

  const getMagsForSegmentationLayer = useCallback(
    (_annotationId: string, layerName: string) => {
      const segmentationLayer = getSegmentationLayerByHumanReadableName(
        dataset,
        annotation,
        layerName,
      );
      return getMagInfo(segmentationLayer.mags);
    },
    [dataset, annotation],
  );
  const userBoundingBoxes = getSomeTracing(annotation).userBoundingBoxes;

  return (
    <>
      <Row style={{ marginBottom: 16 }}>
        <Alert
          message="Please note that this feature is experimental. All bounding boxes should have equal dimensions or have dimensions which are multiples of the smallest bounding box. Ensure the size is not too small (we recommend at least 10 Vx per dimension) and choose boxes that represent the data well."
          type="info"
          showIcon
        />
      </Row>
      <TrainAiModelForm
        getMagsForSegmentationLayer={getMagsForSegmentationLayer}
        ensureSavedState={() => Model.ensureSavedState()}
        onClose={onClose}
        annotationInfos={[
          {
            annotation: annotation,
            dataset,
            volumeTracings: annotation.volumes,
            volumeTracingMags: [],
            userBoundingBoxes,
          },
        ]}
      />
    </>
  );
}
