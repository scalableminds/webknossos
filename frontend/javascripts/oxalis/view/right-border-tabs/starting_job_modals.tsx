import React from "react";
import type { APIJob, APIDataLayer } from "types/api_flow_types";
import { Modal, Select, Button, Form, Input } from "antd";
import {
  startNucleiInferralJob,
  startNeuronInferralJob,
  startApplyMergerModeJob,
  startGlobalizeFloodfillsJob,
} from "admin/admin_rest_api";
import { useSelector } from "react-redux";
import { DatasetNameFormItem } from "admin/dataset/dataset_components";
import { getColorLayers, getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";
import {
  getReadableNameByVolumeTracingId,
  getActiveSegmentationTracingLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import Toast from "libs/toast";
import type { OxalisState, UserBoundingBox, HybridTracing } from "oxalis/store";
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
  handleClose: () => void;
};

type JobApiCallArgsType = {
  newDatasetName: string;
  selectedLayer: APIDataLayer;
  outputSegmentationLayerName?: string;
  selectedBoundingBox: UserBoundingBox | null | undefined;
};
type StartingJobModalProps = Props & {
  jobApiCall: (arg0: JobApiCallArgsType) => Promise<void | APIJob>;
  jobName: keyof typeof jobNameToImagePath;
  description: React.ReactNode;
  isBoundingBoxConfigurable?: boolean;
  chooseSegmentationLayer?: boolean;
  suggestedDatasetSuffix: string;
  fixedSelectedLayer?: APIDataLayer | null | undefined;
};

type LayerSelectionProps = {
  chooseSegmentationLayer: boolean;
  layers: APIDataLayer[];
  tracing: HybridTracing;
  fixedLayerName?: string;
};

function getReadableNameOfVolumeLayer(layer: APIDataLayer, tracing: HybridTracing): string | null {
  return "tracingId" in layer && layer.tracingId != null
    ? getReadableNameByVolumeTracingId(tracing, layer.tracingId)
    : null;
}

function LayerSelectionFromItem({
  chooseSegmentationLayer,
  layers,
  tracing,
  fixedLayerName,
}: LayerSelectionProps): JSX.Element {
  const layerType = chooseSegmentationLayer ? "segmentation layer" : "color layer";
  return (
    <Form.Item
      label={layerType}
      name="layerName"
      rules={[
        {
          required: true,
          message: `Please select the ${layerType} that should be used for this job.`,
        },
      ]}
      hidden={layers.length === 1 && fixedLayerName == null}
    >
      <Select
        showSearch
        placeholder={`Select a ${layerType}`}
        optionFilterProp="children"
        filterOption={(input, option) =>
          // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
          option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
        }
        disabled={fixedLayerName != null}
      >
        {layers.map((layer) => {
          const readableName = getReadableNameOfVolumeLayer(layer, tracing) || layer.name;
          return (
            <Select.Option key={layer.name} value={layer.name}>
              {readableName}
            </Select.Option>
          );
        })}
      </Select>
    </Form.Item>
  );
}

type BoundingBoxSelectionProps = {
  isBoundingBoxConfigurable?: boolean;
  userBoundingBoxes: UserBoundingBox[];
};

function renderUserBoundingBox(bbox: UserBoundingBox | null | undefined) {
  if (!bbox) {
    return null;
  }

  const upscaledColor = bbox.color.map((colorPart) => colorPart * 255) as any as Vector3;
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
}

function BoundingBoxSelectionFormItem({
  isBoundingBoxConfigurable,
  userBoundingBoxes,
}: BoundingBoxSelectionProps): JSX.Element {
  return (
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
            // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
          }
        >
          {userBoundingBoxes.map((userBB) => (
            <Select.Option key={userBB.id} value={userBB.id}>
              {renderUserBoundingBox(userBB)}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>
    </div>
  );
}

type OutputSegmentationLayerNameProps = {
  hasOutputSegmentationLayer: boolean;
  layers: APIDataLayer[];
  additionalAllowedNames: string[];
};

function OutputSegmentationLayerNameFormItem({
  hasOutputSegmentationLayer,
  layers,
  additionalAllowedNames,
}: OutputSegmentationLayerNameProps) {
  return (
    <Form.Item
      label="Name of output segmentation layer"
      name="outputSegmentationLayerName"
      rules={[
        { required: hasOutputSegmentationLayer },
        {
          min: 3,
        },
        {
          pattern: /[0-9a-zA-Z_-]+$/,
        },
        {
          validator: async (_rule, newOutputLayerName) => {
            if (
              layers.some((layer) => layer.name === newOutputLayerName) &&
              !additionalAllowedNames.includes(newOutputLayerName)
            ) {
              const reason =
                "This name is already used by another segmentation layer of this dataset.";
              return Promise.reject(reason);
            } else {
              return Promise.resolve();
            }
          },
        },
      ]}
      hidden={!hasOutputSegmentationLayer}
    >
      <Input />
    </Form.Item>
  );
}

function StartingJobModal(props: StartingJobModalProps) {
  const isBoundingBoxConfigurable = props.isBoundingBoxConfigurable || false;
  const chooseSegmentationLayer = props.chooseSegmentationLayer || false;
  const { handleClose, jobName, description, jobApiCall, fixedSelectedLayer } = props;
  const [form] = Form.useForm();
  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const layers = chooseSegmentationLayer ? getSegmentationLayers(dataset) : getColorLayers(dataset);

  const startJob = async ({
    layerName,
    boundingBoxId,
    name: newDatasetName,
    outputSegmentationLayerName,
  }: {
    layerName: string;
    boundingBoxId: number;
    name: string;
    outputSegmentationLayerName: string;
  }) => {
    const selectedLayer = layers.find((layer) => layer.name === layerName);
    const selectedBoundingBox = userBoundingBoxes.find((bbox) => bbox.id === boundingBoxId);
    if (
      selectedLayer == null ||
      newDatasetName == null ||
      (isBoundingBoxConfigurable && selectedBoundingBox == null)
    ) {
      return;
    }

    try {
      await Model.ensureSavedState();
      const jobArgs: JobApiCallArgsType = {
        outputSegmentationLayerName,
        newDatasetName,
        selectedLayer,
        selectedBoundingBox,
      };
      const apiJob = await jobApiCall(jobArgs);

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

  let initialLayerName = layers.length === 1 ? layers[0].name : null;
  let initialOutputSegmentationLayerName = getReadableNameOfVolumeLayer(layers[0], tracing);
  if (fixedSelectedLayer) {
    initialLayerName = fixedSelectedLayer.name;
    initialOutputSegmentationLayerName = getReadableNameOfVolumeLayer(fixedSelectedLayer, tracing);
  }
  initialOutputSegmentationLayerName = `${initialOutputSegmentationLayerName}_corrected`;
  // TODO: Other jobs also have an output segmentation layer. The names for them should also be configurable.
  const hasOutputSegmentationLayer = jobName === "apply merger mode";
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
          layerName: initialLayerName,
          boundingBoxId: null,
          outputSegmentationLayerName: initialOutputSegmentationLayerName,
        }}
        form={form}
      >
        <DatasetNameFormItem
          label="New Dataset Name"
          activeUser={activeUser}
          initialName={`${dataset.name}_${props.suggestedDatasetSuffix}`}
        />
        <LayerSelectionFromItem
          chooseSegmentationLayer={chooseSegmentationLayer}
          layers={layers}
          fixedLayerName={fixedSelectedLayer?.name}
          tracing={tracing}
        />
        <OutputSegmentationLayerNameFormItem
          hasOutputSegmentationLayer={hasOutputSegmentationLayer}
          layers={layers}
          additionalAllowedNames={[form.getFieldValue("layerName")]}
        />
        <BoundingBoxSelectionFormItem
          isBoundingBoxConfigurable={isBoundingBoxConfigurable}
          userBoundingBoxes={userBoundingBoxes}
        />
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
  const dataset = useSelector((state: OxalisState) => state.dataset);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="nuclei inferral"
      suggestedDatasetSuffix="with_nuclei"
      jobApiCall={async ({ newDatasetName, selectedLayer: colorLayer }) =>
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
  const dataset = useSelector((state: OxalisState) => state.dataset);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="neuron inferral"
      suggestedDatasetSuffix="with_reconstructed_neurons"
      isBoundingBoxConfigurable
      jobApiCall={async ({ newDatasetName, selectedLayer: colorLayer, selectedBoundingBox }) => {
        if (!selectedBoundingBox) {
          return Promise.resolve();
        }

        const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
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
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeSegmentationTracingLayer = useSelector(getActiveSegmentationTracingLayer);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="apply merger mode"
      suggestedDatasetSuffix="with_merged_segmentation"
      chooseSegmentationLayer
      fixedSelectedLayer={activeSegmentationTracingLayer}
      jobApiCall={async ({
        newDatasetName,
        selectedLayer: segmentationLayer,
        outputSegmentationLayerName,
      }) => {
        if (outputSegmentationLayerName == null) {
          return Promise.resolve();
        }
        const volumeLayerName = getReadableNameOfVolumeLayer(segmentationLayer, tracing);
        const baseSegmentationName = getBaseSegmentationName(segmentationLayer);
        return startApplyMergerModeJob(
          dataset.owningOrganization,
          dataset.name,
          baseSegmentationName,
          volumeLayerName,
          newDatasetName,
          outputSegmentationLayerName,
          tracing.annotationId,
          tracing.annotationType,
        );
      }}
      description={
        <p>
          Start a job that takes the current state of this merger mode tracing and applies it to the
          segmentation layer. This will create a new dataset which contains the merged segmentation
          layer. If this dataset has more than one segmentation layer, please select the
          segmentation layer to which the merging should be applied to.
        </p>
      }
    />
  );
}

export function StartGlobalizeFloodfillsModal({ handleClose }: Props) {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  return (
    <StartingJobModal
      handleClose={handleClose}
      jobName="globalization of the floodfill operation(s)"
      suggestedDatasetSuffix="with_floodfills"
      chooseSegmentationLayer
      jobApiCall={async ({ newDatasetName, selectedLayer: segmentationLayer }) => {
        const volumeLayerName = getReadableNameOfVolumeLayer(segmentationLayer, tracing);
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
