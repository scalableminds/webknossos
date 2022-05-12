import React from "react";
import type { APIJob, APIDataLayer } from "types/api_flow_types";
import { Modal, Select, Button, Form, Input } from "antd";
import {
  startNucleiInferralJob,
  startNeuronInferralJob,
  startMaterializingVolumeAnnotationJob,
  startGlobalizeFloodfillsJob,
} from "admin/admin_rest_api";
import { useSelector } from "react-redux";
import { DatasetNameFormItem } from "admin/dataset/dataset_components";
import {
  getColorLayers,
  getSegmentationLayers,
  getDataLayers,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getReadableNameByVolumeTracingId,
  getActiveSegmentationTracingLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import Toast from "libs/toast";
import type { OxalisState, UserBoundingBox, HybridTracing } from "oxalis/store";
import { Unicode, type Vector3 } from "oxalis/constants";
import Model from "oxalis/model";
import { computeArrayFromBoundingBox, rgbToHex } from "libs/utils";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";

const { ThinSpace } = Unicode;
const enum JobNames {
  NEURON_INFERRAL = "neuron inferral",
  NUCLEI_INFERRAL = "nuclei inferral",
  MATERIALIZE_VOLUME_ANNOTATION = "materialize volume annotation",
  GLOBALIZE_FLODDFILLS = "globalization of the floodfill operation(s)",
}
const jobNameToImagePath: Record<JobNames, string | null> = {
  "neuron inferral": "neuron_inferral_example.jpg",
  "nuclei inferral": "nuclei_inferral_example.jpg",
  "materialize volume annotation": "materialize_volume_annotation_example.jpg",
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
  title: string;
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

export function LayerSelection({
  layers,
  tracing,
  fixedLayerName,
  layerType,
  setSelectedLayerName,
  style,
}: {
  layers: APIDataLayer[];
  tracing: HybridTracing;
  fixedLayerName?: string;
  layerType?: string;
  setSelectedLayerName?: React.Dispatch<React.SetStateAction<string>>;
  style?: React.CSSProperties;
}): JSX.Element {
  const onSelect = setSelectedLayerName
    ? (layerName: string) => setSelectedLayerName(layerName)
    : undefined;
  const maybeLayerType = typeof layerType !== "undefined" ? layerType : "";
  const maybeSpace = typeof layerType !== "undefined" ? " " : "";
  return (
    <Select
      showSearch
      placeholder={`Select a ${maybeLayerType}${maybeSpace}layer`}
      optionFilterProp="children"
      filterOption={(input, option) =>
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
      }
      disabled={fixedLayerName != null}
      onSelect={onSelect}
      style={style}
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
  );
}

function LayerSelectionFormItem({
  chooseSegmentationLayer,
  layers,
  tracing,
  fixedLayerName,
}: LayerSelectionProps): JSX.Element {
  const layerType = chooseSegmentationLayer ? "segmentation" : "color";
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
      <LayerSelection
        layers={layers}
        fixedLayerName={fixedLayerName}
        layerType={layerType}
        tracing={tracing}
      />
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

export function BoundingBoxSelection({
  userBoundingBoxes,
  setSelectedBoundingBoxId,
  style,
}: {
  userBoundingBoxes: UserBoundingBox[];
  setSelectedBoundingBoxId?: React.Dispatch<React.SetStateAction<number>>;
  style?: React.CSSProperties;
}): JSX.Element {
  const onSelect = setSelectedBoundingBoxId
    ? (boundingBoxId: number) => setSelectedBoundingBoxId(boundingBoxId)
    : undefined;
  return (
    <Select
      showSearch
      placeholder="Select a bounding box"
      optionFilterProp="children"
      filterOption={(input, option) =>
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
      }
      disabled={userBoundingBoxes.length < 1}
      onSelect={onSelect}
      style={style}
    >
      {userBoundingBoxes.map((userBB) => (
        <Select.Option key={userBB.id} value={userBB.id}>
          {renderUserBoundingBox(userBB)}
        </Select.Option>
      ))}
    </Select>
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
        <BoundingBoxSelection userBoundingBoxes={userBoundingBoxes} />
      </Form.Item>
    </div>
  );
}

type OutputSegmentationLayerNameProps = {
  hasOutputSegmentationLayer: boolean;
  notAllowedLayerNames: string[];
};

export function OutputSegmentationLayerNameFormItem({
  hasOutputSegmentationLayer,
  notAllowedLayerNames,
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
            if (notAllowedLayerNames.includes(newOutputLayerName)) {
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
  const { handleClose, jobName, description, jobApiCall, fixedSelectedLayer, title } = props;
  const [form] = Form.useForm();
  const userBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const layers = chooseSegmentationLayer ? getSegmentationLayers(dataset) : getColorLayers(dataset);
  const allLayers = getDataLayers(dataset);

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
  initialOutputSegmentationLayerName = `${
    initialOutputSegmentationLayerName || "segmentation"
  }_corrected`;
  // TODO: Other jobs also have an output segmentation layer. The names for these jobs should also be configurable.
  const hasOutputSegmentationLayer = jobName === JobNames.MATERIALIZE_VOLUME_ANNOTATION;
  const notAllowedOutputLayerNames = allLayers
    .filter((layer) => {
      // Existing layer names may not be used for the output layer. The only exception
      // is the name of the currently selected layer. This layer is the only one not
      // copied over from the original dataset to the output dataset.
      // Therefore, this name is available as the name for the output layer name.
      // That is why that layer is filtered out here.
      const currentSelectedVolumeLayerName = form.getFieldValue("layerName") || initialLayerName;
      return (
        getReadableNameOfVolumeLayer(layer, tracing) !== currentSelectedVolumeLayerName &&
        layer.name !== currentSelectedVolumeLayerName
      );
    })
    .map((layer) => getReadableNameOfVolumeLayer(layer, tracing) || layer.name);

  return (
    <Modal title={title} onCancel={handleClose} visible width={700} footer={null}>
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
        <LayerSelectionFormItem
          chooseSegmentationLayer={chooseSegmentationLayer}
          layers={layers}
          fixedLayerName={fixedSelectedLayer?.name}
          tracing={tracing}
        />
        <OutputSegmentationLayerNameFormItem
          hasOutputSegmentationLayer={hasOutputSegmentationLayer}
          notAllowedLayerNames={notAllowedOutputLayerNames}
        />
        <BoundingBoxSelectionFormItem
          isBoundingBoxConfigurable={isBoundingBoxConfigurable}
          userBoundingBoxes={userBoundingBoxes}
        />
        <div style={{ textAlign: "center" }}>
          <Button type="primary" size="large" htmlType="submit">
            {title}
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
      jobName={JobNames.NUCLEI_INFERRAL}
      title="Start a Nuclei Inferral"
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
      jobName={JobNames.NEURON_INFERRAL}
      title="Start a Neuron Inferral"
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

type MaterializeVolumeAnnotationModalProps = Props & {
  selectedVolumeLayer?: APIDataLayer;
};

export function MaterializeVolumeAnnotationModal({
  selectedVolumeLayer,
  handleClose,
}: MaterializeVolumeAnnotationModalProps) {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeSegmentationTracingLayer = useSelector(getActiveSegmentationTracingLayer);
  const fixedSelectedLayer = selectedVolumeLayer || activeSegmentationTracingLayer;
  const readableVolumeLayerName =
    fixedSelectedLayer && getReadableNameOfVolumeLayer(fixedSelectedLayer, tracing);
  const hasFallbackLayer =
    fixedSelectedLayer && "tracingId" in fixedSelectedLayer
      ? fixedSelectedLayer.fallbackLayer != null
      : false;
  const isMergerModeEnabled = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
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
  }

  return (
    <StartingJobModal
      handleClose={handleClose}
      title="Start Materializing this Volume Annotation"
      jobName={JobNames.MATERIALIZE_VOLUME_ANNOTATION}
      suggestedDatasetSuffix="with_merged_segmentation"
      chooseSegmentationLayer
      fixedSelectedLayer={fixedSelectedLayer}
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
        return startMaterializingVolumeAnnotationJob(
          dataset.owningOrganization,
          dataset.name,
          baseSegmentationName,
          volumeLayerName,
          newDatasetName,
          outputSegmentationLayerName,
          tracing.annotationId,
          tracing.annotationType,
          isMergerModeEnabled,
        );
      }}
      description={description}
    />
  );
}

export function StartGlobalizeFloodfillsModal({ handleClose }: Props) {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  return (
    <StartingJobModal
      handleClose={handleClose}
      title="Start Globalizing of the Floodfill Operation(s)"
      jobName={JobNames.GLOBALIZE_FLODDFILLS}
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
