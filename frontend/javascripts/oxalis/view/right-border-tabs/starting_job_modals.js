// @flow
import React, { type Node } from "react";
import type { APIJob, APIDataLayer } from "types/api_flow_types";
import { Modal, Select, Button, Form } from "antd";
import {
  startNucleiInferralJob,
  startNeuronInferralJob,
  startApplyMergerModeJob,
  startGlobalizeFloodfillsJob,
} from "admin/admin_rest_api";
import { useSelector } from "react-redux";
import { DatasetNameFormItem } from "admin/dataset/dataset_components";
import { getColorLayers, getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";
import { getReadableNameByVolumeTracingId } from "oxalis/model/accessors/volumetracing_accessor";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import Toast from "libs/toast";
import { type UserBoundingBox } from "oxalis/store";
import { Unicode, type Vector3 } from "oxalis/constants";
import Model from "oxalis/model";
import { capitalizeWords, computeArrayFromBoundingBox, rgbToHex } from "libs/utils";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";

const { ThinSpace } = Unicode;

const jobNameToImagePath = {
  "neuron inferral": "neuron_inferral_example.jpg",
  "nuclei inferral": "nuclei_inferral_example.jpg",
  "apply merger mode": "apply_merger_mode_example.jpg",
  "globalization of the floodfill operation(s)": null,
};

type Props = {
  handleClose: () => void,
};
type StartingJobModalProps = {
  ...Props,
  jobApiCall: (string, APIDataLayer, ?UserBoundingBox) => Promise<?APIJob>,
  jobName: string,
  description: Node,
  isBoundingBoxConfigurable?: boolean,
  chooseSegmentationLayer?: boolean,
  suggestedDatasetSuffix: string,
};

function StartingJobModal(props: StartingJobModalProps) {
  const isBoundingBoxConfigurable = props.isBoundingBoxConfigurable || false;
  const chooseSegmentationLayer = props.chooseSegmentationLayer || false;
  const { handleClose, jobName, description, jobApiCall } = props;
  const userBoundingBoxes = useSelector(state => getUserBoundingBoxesFromState(state));
  const tracing = useSelector(store => store.tracing);
  const dataset = useSelector(store => store.dataset);
  const activeUser = useSelector(state => state.activeUser);
  const layers = chooseSegmentationLayer ? getSegmentationLayers(dataset) : getColorLayers(dataset);

  const startJob = async ({ layerName, boundingBoxId, name: newDatasetName }) => {
    const selectedLayer = layers.find(layer => layer.name === layerName);
    const selectedBoundingBox = userBoundingBoxes.find(bbox => bbox.id === boundingBoxId);
    if (
      selectedLayer == null ||
      newDatasetName == null ||
      (isBoundingBoxConfigurable && selectedBoundingBox == null)
    ) {
      return;
    }
    try {
      await Model.ensureSavedState();
      let apiJob;
      if (isBoundingBoxConfigurable) {
        apiJob = await jobApiCall(newDatasetName, selectedLayer, selectedBoundingBox);
      } else {
        apiJob = await jobApiCall(newDatasetName, selectedLayer);
      }
      if (!apiJob) {
        return;
      }
      Toast.info(
        <>
          The {jobName} job has been started. You can look in the{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          view under Administration for details on the progress of this job.
        </>,
      );
      handleClose();
    } catch (error) {
      console.error(error);
      Toast.error(
        `The ${jobName} job could not be started. Please contact an administrator or look in the console for more details.`,
      );
      handleClose();
    }
  };
  const LayerSelectionFromItem = (): Node => {
    const layerType = chooseSegmentationLayer ? "segmentation layer" : "color layer";
    return (
      <Form.Item
        label={layerType}
        name="layerName"
        rules={[
          {
            required: true,
            message: `Please the ${layerType} that should be used for this job.`,
          },
        ]}
        hidden={layers.length === 1}
      >
        <Select
          showSearch
          placeholder={`Select a ${layerType}`}
          optionFilterProp="children"
          filterOption={(input, option) =>
            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
          }
        >
          {layers.map(layer => {
            const readableName =
              layer.tracingId != null
                ? getReadableNameByVolumeTracingId(tracing, layer.tracingId)
                : layer.name;
            return (
              <Select.Option key={layer.name} value={layer.name}>
                {readableName}
              </Select.Option>
            );
          })}
        </Select>
      </Form.Item>
    );
  };
  const renderUserBoundingBox = (bbox: ?UserBoundingBox) => {
    if (!bbox) {
      return null;
    }
    const upscaledColor = ((bbox.color.map(colorPart => colorPart * 255): any): Vector3);
    const colorAsHexString = rgbToHex(upscaledColor);
    return (
      <>
        <div
          className="color-display-wrapper"
          style={{
            backgroundColor: colorAsHexString,
            marginTop: -2,
            marginRight: 6,
          }}
        />
        {bbox.name} ({computeArrayFromBoundingBox(bbox.boundingBox).join(", ")})
      </>
    );
  };
  const BoundingBoxSelectionFormItem = (): Node => (
    <div style={isBoundingBoxConfigurable ? {} : { display: "none" }}>
      <p>
        Please select the bounding box for which the inferral should be computed. Note that large
        bounding boxes can take very long. You can create a new bounding box for the desired volume
        with the bounding box tool in the toolbar at the top. The created bounding boxes will be
        listed below.
      </p>
      <Form.Item
        label="Bounding Box"
        name="boundingBoxId"
        rules={[
          {
            required: isBoundingBoxConfigurable,
            message: "Please select the bounding box for which the inferral should be computed.",
          },
        ]}
        hidden={!isBoundingBoxConfigurable}
      >
        <Select
          showSearch
          placeholder="Select a bounding box"
          optionFilterProp="children"
          filterOption={(input, option) =>
            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
          }
        >
          {userBoundingBoxes.map(userBB => (
            <Select.Option key={userBB.id} value={userBB.id}>
              {renderUserBoundingBox(userBB)}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>
    </div>
  );

  return (
    <Modal
      title={`Start ${capitalizeWords(jobName)}`}
      onCancel={handleClose}
      visible
      width={700}
      footer={null}
    >
      {description}
      <br />
      {jobNameToImagePath[jobName] != null ? (
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
      ) : null}
      <Form
        onFinish={startJob}
        layout="vertical"
        initialValues={{
          layerName: layers.length === 1 ? layers[0].name : null,
          boundingBoxId: null,
        }}
      >
        <DatasetNameFormItem
          label="New Dataset Name"
          activeUser={activeUser}
          initialName={`${dataset.name}_${props.suggestedDatasetSuffix}`}
        />
        <LayerSelectionFromItem />
        <BoundingBoxSelectionFormItem />

        <div style={{ textAlign: "center" }}>
          <Button type="primary" size="large" htmlType="submit">
            Start {capitalizeWords(jobName)}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}

export function NucleiInferralModal({ handleClose }: Props) {
  const dataset = useSelector(state => state.dataset);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="nuclei inferral"
      suggestedDatasetSuffix="with_nuclei"
      jobApiCall={async (newDatasetName, colorLayer) =>
        startNucleiInferralJob(
          dataset.owningOrganization,
          dataset.name,
          colorLayer.name,
          newDatasetName,
        )
      }
      description={
        <>
          <p>
            Start a job that automatically detects nuclei for this dataset. This job creates a copy
            of this dataset once it has finished. The new dataset will contain the detected nuclei
            as a segmentation layer.
          </p>
          <p>
            <b>
              Note that this feature is still experimental. Nuclei detection currently works best
              with EM data and a resolution of approximately 200{ThinSpace}nm per voxel. The
              inferral process will automatically use the magnification that matches that resolution
              best.
            </b>
          </p>
        </>
      }
    />
  );
}

export function NeuronInferralModal({ handleClose }: Props) {
  const dataset = useSelector(state => state.dataset);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="neuron inferral"
      suggestedDatasetSuffix="with_reconstructed_neurons"
      isBoundingBoxConfigurable
      jobApiCall={async (newDatasetName, colorLayer, boundingBox) => {
        if (!boundingBox) {
          return Promise.resolve();
        }
        const bbox = computeArrayFromBoundingBox(boundingBox.boundingBox);
        return startNeuronInferralJob(
          dataset.owningOrganization,
          dataset.name,
          colorLayer.name,
          bbox,
          newDatasetName,
        );
      }}
      description={
        <>
          <p>
            Start a job that automatically detects the neurons for this dataset. This job creates a
            copy of this dataset once it has finished. The new dataset will contain the new
            segmentation which segments the neurons of the dataset.
          </p>
          <p>
            <b>
              Note that this feature is still experimental and can take a long time. Thus we suggest
              to use a small bounding box and not the full dataset extent. The neuron detection
              currently works best with EM data. The best resolution for the process will be chosen
              automatically.
            </b>
          </p>
        </>
      }
    />
  );
}

export function ApplyMergerModeModal({ handleClose }: Props) {
  const dataset = useSelector(state => state.dataset);
  const tracing = useSelector(store => store.tracing);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="apply merger mode"
      suggestedDatasetSuffix="with_merged_segmentation"
      chooseSegmentationLayer
      jobApiCall={async (newDatasetName, segmentationLayer) => {
        const volumeLayerName =
          segmentationLayer.tracingId != null
            ? getReadableNameByVolumeTracingId(tracing, segmentationLayer.tracingId)
            : null;
        const baseSegmentationName = getBaseSegmentationName(segmentationLayer);
        return startApplyMergerModeJob(
          dataset.owningOrganization,
          dataset.name,
          baseSegmentationName,
          volumeLayerName,
          newDatasetName,
          tracing.annotationId,
          tracing.annotationType,
        );
      }}
      description={
        <p>
          Start a job that take the current state of this merger mode tracing and apply it to the
          segmentation layer. This will create a new dataset which contains the merged segmentation
          layer. If this dataset has more than one segmentation layer, please select the
          segmentation layer to the merging should be applied to.
        </p>
      }
    />
  );
}

export function StartGlobalizeFloodfillsModal({ handleClose }: Props) {
  const dataset = useSelector(state => state.dataset);
  const tracing = useSelector(store => store.tracing);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="globalization of the floodfill operation(s)"
      suggestedDatasetSuffix="with_floodfills"
      chooseSegmentationLayer
      jobApiCall={async (newDatasetName, segmentationLayer) => {
        const volumeLayerName =
          segmentationLayer.tracingId != null
            ? getReadableNameByVolumeTracingId(tracing, segmentationLayer.tracingId)
            : null;
        const baseSegmentationName = getBaseSegmentationName(segmentationLayer);
        return startGlobalizeFloodfillsJob(
          dataset.owningOrganization,
          dataset.name,
          baseSegmentationName,
          volumeLayerName,
          newDatasetName,
          tracing.annotationId,
          tracing.annotationType,
        );
      }}
      description={
        <p>
          For this annotation some floodfill operations have not run to completion, because they
          covered a too large volume. webKnossos can finish these operations via a long-running job.
          This job will copy the current dataset, apply the changes of the current volume annotation
          into the volume layer and use the existing bounding boxes as seeds to continue the
          remaining floodfill operations (i.e., &quot;globalize&quot; them).
        </p>
      }
    />
  );
}
