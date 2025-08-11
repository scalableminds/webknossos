import { startMaterializingVolumeAnnotationJob } from "admin/rest_api";
import { Modal } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { computeArrayFromBoundingBox } from "libs/utils";
import type { APIDataLayer } from "types/api_types";
import { APIJobType } from "types/api_types";
import {
  getActiveSegmentationTracingLayer,
  getReadableNameOfVolumeLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import { getBaseSegmentationName } from "viewer/view/right-border-tabs/segments_tab/segments_view_helper";
import { jobNameToImagePath } from "./constants";
import { StartJobForm } from "./forms/start_job_form";

type Props = {
  handleClose: () => void;
};

type MaterializeVolumeAnnotationModalProps = Props & {
  selectedVolumeLayer?: APIDataLayer;
};

export function MaterializeVolumeAnnotationModal({
  selectedVolumeLayer,
  handleClose,
}: MaterializeVolumeAnnotationModalProps) {
  const dataset = useWkSelector((state) => state.dataset);
  const tracing = useWkSelector((state) => state.annotation);
  let includesEditableMapping = false;
  const activeSegmentationTracingLayer = useWkSelector(getActiveSegmentationTracingLayer);
  const fixedSelectedLayer = selectedVolumeLayer || activeSegmentationTracingLayer;
  const readableVolumeLayerName =
    fixedSelectedLayer && getReadableNameOfVolumeLayer(fixedSelectedLayer, tracing);
  const hasFallbackLayer =
    fixedSelectedLayer && "tracingId" in fixedSelectedLayer
      ? fixedSelectedLayer.fallbackLayer != null
      : false;
  const isMergerModeEnabled = useWkSelector(
    (state) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const jobName = "materialize_volume_annotation";
  let description = (
    <p>
      Start a job that takes the current state of this volume annotation and materializes it into a
      new dataset.
      {hasFallbackLayer
        ? ` All annotations done on the "${readableVolumeLayerName}" volume layer will be merged with the data of the fallback layer. `
        : null}
      {isMergerModeEnabled
        ? " Since the merger mode is currently active, the segments connected via skeleton nodes will be merged within the new output dataset. "
        : " "}
      Please enter the name of the output dataset and the output segmentation layer.
    </p>
  );
  if (tracing.volumes.length === 0) {
    description = (
      <p>
        Start a job that takes the current state of this merger mode tracing and materializes it
        into a new dataset. Since the merger mode is currently active, the segments connected via
        skeleton nodes will be merged within the new output dataset. Please enter the name of the
        output dataset and the output segmentation layer.
      </p>
    );
  } else if (fixedSelectedLayer && "tracingId" in fixedSelectedLayer) {
    includesEditableMapping =
      tracing.volumes.find((volume) => volume.tracingId === fixedSelectedLayer.tracingId)
        ?.hasEditableMapping === true;
  }
  const jobImage =
    jobNameToImagePath[jobName] != null ? (
      <>
        <div style={{ textAlign: "center" }}>
          <img
            src={`/assets/images/${jobNameToImagePath[jobName]}`}
            alt={`${jobName} example`}
            style={{ width: 400, height: "auto", borderRadius: 3 }}
          />
        </div>
        <br />
      </>
    ) : null;

  return (
    <Modal
      onCancel={handleClose}
      open
      width={700}
      footer={null}
      title="Volume Annotation Materialization"
    >
      <StartJobForm
        handleClose={handleClose}
        title="Start Materializing this Volume Annotation"
        jobName={APIJobType.MATERIALIZE_VOLUME_ANNOTATION}
        suggestedDatasetSuffix="with_merged_segmentation"
        chooseSegmentationLayer
        isBoundingBoxConfigurable={includesEditableMapping}
        fixedSelectedLayer={fixedSelectedLayer}
        jobApiCall={async ({
          newDatasetName,
          selectedLayer: segmentationLayer,
          selectedBoundingBox,
        }) => {
          // There are 3 cases for the value assignments to volumeLayerName and baseSegmentationName for the job:
          // 1. There is a volume annotation with a fallback layer. volumeLayerName will reference the volume layer
          // and baseSegmentationName will reference the fallback layer. The job will merge those layers.
          // 2. There is a segmentation layer without a fallback layer. volumeLayerName will be null and baseSegmentationName
          // will reference the segmentation layer. The job will use the segmentation layer without any merging.
          // 3. There is a volume annotation without a fallback layer. volumeLayerName will be null
          // and baseSegmentationName will reference the volume layer. The job will use the volume annotation without any merging.
          const volumeLayerName =
            "fallbackLayer" in segmentationLayer && segmentationLayer.fallbackLayer != null
              ? getReadableNameOfVolumeLayer(segmentationLayer, tracing)
              : null;
          const baseSegmentationName = getBaseSegmentationName(segmentationLayer);
          const bbox = selectedBoundingBox?.boundingBox
            ? computeArrayFromBoundingBox(selectedBoundingBox.boundingBox)
            : undefined;
          return startMaterializingVolumeAnnotationJob(
            dataset.id,
            baseSegmentationName,
            volumeLayerName,
            newDatasetName,
            tracing.annotationId,
            tracing.annotationType,
            isMergerModeEnabled,
            includesEditableMapping,
            bbox,
          );
        }}
        description={
          <div>
            {description}
            <br />
            {jobImage}
          </div>
        }
      />
    </Modal>
  );
}
