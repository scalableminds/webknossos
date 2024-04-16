import React from "react";
import type { APIJob, APIDataLayer } from "types/api_flow_types";
import {
  Modal,
  Select,
  Button,
  Form,
  Input,
  Slider,
  Row,
  Space,
  Radio,
  Card,
  Tooltip,
  Alert,
} from "antd";
import {
  startNucleiInferralJob,
  startMaterializingVolumeAnnotationJob,
  startNeuronInferralJob,
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
import { ControlModeEnum, Unicode, type Vector3 } from "oxalis/constants";
import { Model, Store } from "oxalis/singletons";
import {
  clamp,
  computeArrayFromBoundingBox,
  computeBoundingBoxFromBoundingBoxObject,
  rgbToHex,
} from "libs/utils";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { V3 } from "libs/mjs";
import { ResolutionInfo } from "oxalis/model/helpers/resolution_info";
import { isBoundingBoxExportable } from "./download_modal_view";
import features from "features";
import { setAIJobModalStateAction } from "oxalis/model/actions/ui_actions";
import { InfoCircleOutlined } from "@ant-design/icons";

const { ThinSpace } = Unicode;

export type StartAIJobModalState =
  | "neuron_inferral"
  | "nuclei_inferral"
  | "mitochondria_inferral"
  | "invisible";

// "materialize_volume_annotation" is only used in this module
const jobNameToImagePath: Record<
  StartAIJobModalState | "materialize_volume_annotation",
  string | null
> = {
  neuron_inferral: "neuron_inferral_example.jpg",
  nuclei_inferral: "nuclei_inferral_example.jpg",
  mitochondria_inferral: "mito_inferral_example.jpg",
  materialize_volume_annotation: "materialize_volume_annotation_example.jpg",
  invisible: "",
};
const jobTypeWithConfigurableOutputSegmentationLayerName = [
  "materialize_volume_annotation",
  "neuron_inferral",
];
type Props = {
  handleClose: () => void;
};

type StartAIJobModalProps = {
  aIJobModalState: StartAIJobModalState;
};

type JobApiCallArgsType = {
  newDatasetName: string;
  selectedLayer: APIDataLayer;
  outputSegmentationLayerName?: string;
  selectedBoundingBox: UserBoundingBox | null | undefined;
};
type StartJobFormProps = Props & {
  jobApiCall: (arg0: JobApiCallArgsType) => Promise<void | APIJob>;
  jobName: keyof typeof jobNameToImagePath;
  description: React.ReactNode;
  isBoundingBoxConfigurable?: boolean;
  chooseSegmentationLayer?: boolean;
  suggestedDatasetSuffix: string;
  fixedSelectedLayer?: APIDataLayer | null | undefined;
  title: string;
  buttonLabel?: string | null;
};

type LayerSelectionProps = {
  chooseSegmentationLayer: boolean;
  layers: APIDataLayer[];
  tracing: HybridTracing;
  fixedLayerName?: string;
};

export function getReadableNameOfVolumeLayer(
  layer: APIDataLayer,
  tracing: HybridTracing,
): string | null {
  return "tracingId" in layer && layer.tracingId != null
    ? getReadableNameByVolumeTracingId(tracing, layer.tracingId)
    : null;
}

export function LayerSelection({
  layers,
  tracing,
  fixedLayerName,
  layerType,
  onChange,
  style,
  value,
}: {
  layers: APIDataLayer[];
  tracing: HybridTracing;
  fixedLayerName?: string;
  layerType?: string;
  style?: React.CSSProperties;
  // onChange and value should not be renamed, because these are the
  // default property names for controlled antd FormItems.
  onChange?: (a: string) => void;
  value?: string | null;
}): JSX.Element {
  const onSelect = onChange ? (layerName: string) => onChange(layerName) : undefined;
  const maybeLayerType = layerType || "";
  const maybeSpace = layerType != null ? " " : "";
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
      value={value}
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
      label="Layer"
      name="layerName"
      rules={[
        {
          required: true,
          message: `Please select the ${layerType} layer that should be used for this job.`,
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
  onChangeSelectedBoundingBox: (bBoxId: number | null) => void;
  value: number | null;
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
  value,
}: {
  userBoundingBoxes: UserBoundingBox[];
  setSelectedBoundingBoxId?: (boundingBoxId: number | null) => void;
  style?: React.CSSProperties;
  value: number | null;
}): JSX.Element {
  return (
    <Select
      placeholder="Select a bounding box"
      optionFilterProp="children"
      filterOption={(input, option) =>
        // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
        option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
      }
      disabled={userBoundingBoxes.length < 1}
      onSelect={setSelectedBoundingBoxId}
      style={style}
      value={value}
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
  onChangeSelectedBoundingBox,
  value: selectedBoundingBoxId,
}: BoundingBoxSelectionProps): JSX.Element {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const isInDatasetViewMode = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const colorLayer = getColorLayers(dataset)[0];
  const mag1 = colorLayer.resolutions[0];
  const howToCreateBoundingBoxText = isInDatasetViewMode
    ? "To process only a part of the dataset, please create an annotation and create a bounding box in it using the bounding box tool in the toolbar at the top."
    : "You can create a new bounding box for the desired volume with the bounding box tool in the toolbar at the top. The created bounding boxes will be listed below.";
  return (
    <div style={isBoundingBoxConfigurable ? {} : { display: "none" }}>
      <Form.Item
        label={
          <div>
            <Space>
              Bounding Box
              <Tooltip
                title={`Please select the bounding box which should be processed. Note that large bounding boxes can take very long. ${howToCreateBoundingBoxText}`}
              >
                <InfoCircleOutlined />
              </Tooltip>
            </Space>
          </div>
        }
        name="boundingBoxId"
        rules={[
          {
            required: isBoundingBoxConfigurable,
            message: "Please select the bounding box for which the inferral should be computed.",
          },
          {
            validator: (_rule, value) => {
              if (!isBoundingBoxConfigurable) return Promise.resolve();

              const selectedBoundingBox = userBoundingBoxes.find((bbox) => bbox.id === value);
              let rejectionReason = "";
              if (selectedBoundingBox) {
                const { isExportable, alerts: _ } = isBoundingBoxExportable(
                  selectedBoundingBox.boundingBox,
                  mag1,
                );
                if (isExportable) return Promise.resolve();
                rejectionReason = `The volume of the selected bounding box is too large. The AI neuron segmentation trial is only supported for up to ${
                  features().exportTiffMaxVolumeMVx
                } Megavoxels. Additionally, no bounding box edge should be longer than ${
                  features().exportTiffMaxEdgeLengthVx
                }vx.`;
              }
              // In case no bounding box was selected, the rejectionReason will be "", because the previous rule already checks that.
              return Promise.reject(rejectionReason);
            },
          },
        ]}
        hidden={!isBoundingBoxConfigurable}
      >
        <BoundingBoxSelection
          userBoundingBoxes={userBoundingBoxes}
          setSelectedBoundingBoxId={onChangeSelectedBoundingBox}
          value={selectedBoundingBoxId}
        />
      </Form.Item>
    </div>
  );
}

export function MagSlider({
  resolutionInfo,
  value,
  onChange,
}: {
  resolutionInfo: ResolutionInfo;
  value: Vector3;
  onChange: (v: Vector3) => void;
}) {
  // Use `getResolutionsWithIndices` because returns a sorted list
  const allMags = resolutionInfo.getResolutionsWithIndices();

  return (
    <Slider
      tooltip={{
        formatter: () => value.join("-"),
      }}
      min={0}
      max={allMags.length - 1}
      step={1}
      value={clamp(
        0,
        allMags.findIndex(([, v]) => V3.equals(v, value)),
        allMags.length - 1,
      )}
      onChange={(value) => onChange(allMags[value][1])}
    />
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

export function StartAIJobModal({ aIJobModalState }: StartAIJobModalProps) {
  const centerImageStyle = {
    margin: "auto",
    width: 150,
  };
  return aIJobModalState !== "invisible" ? (
    <Modal
      width={667}
      open
      title={
        <>
          <i className="fas fa-magic icon-margin-right" />
          AI Analysis
        </>
      }
      onCancel={() => Store.dispatch(setAIJobModalStateAction("invisible"))}
      footer={null}
    >
      <Space direction="vertical" size="middle">
        <Row>Choose a processing job for your dataset:</Row>
        <Space align="center">
          <Radio.Button
            className="aIJobSelection"
            checked={aIJobModalState === "neuron_inferral"}
            onClick={() => Store.dispatch(setAIJobModalStateAction("neuron_inferral"))}
          >
            <Card bordered={false}>
              <Space direction="vertical" size="small">
                <Row className="ai-job-title">Neuron segmentation</Row>
                <Row>
                  <img
                    src={`/assets/images/${jobNameToImagePath.neuron_inferral}`}
                    alt={"Neuron segmentation example"}
                    style={centerImageStyle}
                  />
                </Row>
              </Space>
            </Card>
          </Radio.Button>
          <Tooltip title="Coming soon">
            <Radio.Button
              className="aIJobSelection"
              disabled
              checked={aIJobModalState === "nuclei_inferral"}
              onClick={() => Store.dispatch(setAIJobModalStateAction("nuclei_inferral"))}
            >
              <Card bordered={false}>
                <Space direction="vertical" size="small">
                  <Row className="ai-job-title">Nuclei detection</Row>
                  <Row>
                    <img
                      src={`/assets/images/${jobNameToImagePath.nuclei_inferral}`}
                      alt={"Nuclei detection example"}
                      style={centerImageStyle}
                    />
                  </Row>
                </Space>
              </Card>
            </Radio.Button>
          </Tooltip>
          <Tooltip title="Coming soon">
            <Radio.Button
              className="aIJobSelection"
              disabled
              checked={aIJobModalState === "mitochondria_inferral"}
              onClick={() => Store.dispatch(setAIJobModalStateAction("mitochondria_inferral"))}
            >
              <Card bordered={false}>
                <Space direction="vertical" size="small">
                  <Row className="ai-job-title">Mitochondria detection</Row>
                  <Row>
                    <img
                      src={`/assets/images/${jobNameToImagePath.mitochondria_inferral}`}
                      alt={"Mitochondria detection example"}
                      style={centerImageStyle}
                    />
                  </Row>
                </Space>
              </Card>
            </Radio.Button>
          </Tooltip>
        </Space>
        {aIJobModalState === "neuron_inferral" ? <NeuronSegmentationForm /> : null}
        {aIJobModalState === "nuclei_inferral" ? <NucleiDetectionForm /> : null}
      </Space>
    </Modal>
  ) : null;
}

function StartJobForm(props: StartJobFormProps) {
  const isBoundingBoxConfigurable = props.isBoundingBoxConfigurable || false;
  const chooseSegmentationLayer = props.chooseSegmentationLayer || false;
  const { handleClose, jobName, jobApiCall, fixedSelectedLayer, title, description } = props;
  const [form] = Form.useForm();
  const rawUserBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const layers = chooseSegmentationLayer ? getSegmentationLayers(dataset) : getColorLayers(dataset);
  const allLayers = getDataLayers(dataset);
  const defaultBBForLayers: UserBoundingBox[] = layers.map((layer, index) => {
    return {
      id: -1 * index,
      name: `Full ${layer.name} layer`,
      boundingBox: computeBoundingBoxFromBoundingBoxObject(layer.boundingBox),
      color: [255, 255, 255],
      isVisible: true,
    };
  });
  const userBoundingBoxes = defaultBBForLayers.concat(rawUserBoundingBoxes);

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
          The {jobName} job has been started. See the{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          view under Administration for details on the progress of this job.
        </>,
      );
      handleClose();
    } catch (error) {
      Toast.error(
        `The ${jobName} job could not be started. Please contact an administrator or look in the console for more details.`,
      );
      console.error(error);
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
  const hasOutputSegmentationLayer =
    jobTypeWithConfigurableOutputSegmentationLayerName.indexOf(jobName) > -1;
  const notAllowedOutputLayerNames = allLayers
    .filter((layer) => {
      // Existing layer names may not be used for the output layer. The only exception
      // is the name of the currently selected layer. This layer is the only one not
      // copied over from the original dataset to the output dataset.
      // Therefore, this name is available as the name for the output layer name.
      // That is why that layer is filtered out here.
      const currentSelectedVolumeLayerName = chooseSegmentationLayer
        ? form.getFieldValue("layerName") || initialLayerName
        : undefined;
      return (
        getReadableNameOfVolumeLayer(layer, tracing) !== currentSelectedVolumeLayerName &&
        layer.name !== currentSelectedVolumeLayerName
      );
    })
    .map((layer) => getReadableNameOfVolumeLayer(layer, tracing) || layer.name);
  return (
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
      {description}
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
        onChangeSelectedBoundingBox={(bBoxId) => form.setFieldsValue({ boundingBoxId: bBoxId })}
        value={form.getFieldValue("boundingBoxId")}
      />
      <div style={{ textAlign: "center" }}>
        <Button type="primary" size="large" htmlType="submit">
          {props.buttonLabel ? props.buttonLabel : title}
        </Button>
      </div>
    </Form>
  );
}

export function NucleiDetectionForm() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  return (
    <StartJobForm
      handleClose={() => Store.dispatch(setAIJobModalStateAction("invisible"))}
      buttonLabel="Start AI nuclei detection"
      jobName={"nuclei_inferral"}
      title="AI Nuclei Segmentation"
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
            Start an AI background job to automatically detect and segment all nuclei in this
            dataset. This AI will create a copy of this dataset containing all the detected nuclei
            as a new segmentation layer.
          </p>
          <p>
            <b>
              Note that this feature is still experimental. Nuclei detection currently only works
              with EM data and a resolution of approximately 200{ThinSpace}nm per voxel. The
              segmentation process will automatically use the magnification that matches that
              resolution best.
            </b>
          </p>
        </>
      }
    />
  );
}
export function NeuronSegmentationForm() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  return (
    <StartJobForm
      handleClose={() => Store.dispatch(setAIJobModalStateAction("invisible"))}
      jobName={"neuron_inferral"}
      buttonLabel="Start AI neuron segmentation"
      title="AI Neuron Segmentation"
      suggestedDatasetSuffix="with_reconstructed_neurons"
      isBoundingBoxConfigurable
      jobApiCall={async ({
        newDatasetName,
        selectedLayer: colorLayer,
        selectedBoundingBox,
        outputSegmentationLayerName,
      }) => {
        if (!selectedBoundingBox || !outputSegmentationLayerName) {
          return;
        }

        const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
        return startNeuronInferralJob(
          dataset.owningOrganization,
          dataset.name,
          colorLayer.name,
          bbox,
          outputSegmentationLayerName,
          newDatasetName,
        );
      }}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row>
              This job will automatically detect and segment all neurons in this dataset. The AI
              will create a copy of this dataset containing the new neuron segmentation.
            </Row>
            <Row style={{ display: "grid", marginBottom: 16 }}>
              <Alert
                message="Please note that this feature is experimental and currently only works with electron
                microscopy data."
                type="warning"
                showIcon
              />
            </Row>
          </Space>
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
        jobName={"materialize_volume_annotation"}
        suggestedDatasetSuffix="with_merged_segmentation"
        chooseSegmentationLayer
        fixedSelectedLayer={fixedSelectedLayer}
        jobApiCall={async ({
          newDatasetName,
          selectedLayer: segmentationLayer,
          outputSegmentationLayerName,
        }) => {
          if (outputSegmentationLayerName == null) {
            return;
          }
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
