import { InfoCircleOutlined } from "@ant-design/icons";
import {
  getAiModels,
  getOrganization,
  runInferenceJob,
  startAlignSectionsJob,
  startMaterializingVolumeAnnotationJob,
  startMitochondriaInferralJob,
  startNeuronInferralJob,
  startNucleiInferralJob,
} from "admin/admin_rest_api";
import { DatasetNameFormItem } from "admin/dataset/dataset_components";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  type FormInstance,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tooltip,
} from "antd";
import { LayerSelectionFormItem } from "components/layer_selection";
import { Slider } from "components/slider";
import features from "features";
import { formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useGuardedFetch } from "libs/react_helpers";
import Toast from "libs/toast";
import {
  clamp,
  computeArrayFromBoundingBox,
  computeBoundingBoxFromBoundingBoxObject,
  rgbToHex,
} from "libs/utils";
import _ from "lodash";
import { ControlModeEnum, Unicode, type Vector3 } from "oxalis/constants";
import { getColorLayers, getSegmentationLayers } from "oxalis/model/accessors/dataset_accessor";
import { getUserBoundingBoxesFromState } from "oxalis/model/accessors/tracing_accessor";
import {
  getActiveSegmentationTracingLayer,
  getReadableNameOfVolumeLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { setActiveOrganizationAction } from "oxalis/model/actions/organization_actions";
import { setAIJobModalStateAction } from "oxalis/model/actions/ui_actions";
import BoundingBox from "oxalis/model/bucket_data_handling/bounding_box";
import type { MagInfo } from "oxalis/model/helpers/mag_info";
import { Model, Store } from "oxalis/singletons";
import type { OxalisState, UserBoundingBox } from "oxalis/store";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { APIDataLayer, APIJob } from "types/api_flow_types";
import {
  CollapsibleWorkflowYamlEditor,
  TrainAiModelFromAnnotationTab,
} from "../jobs/train_ai_model";
import DEFAULT_PREDICT_WORKFLOW from "./default-predict-workflow-template";
import { isBoundingBoxExportable } from "./download_modal_view";

const { ThinSpace } = Unicode;

export type StartAIJobModalState =
  | "neuron_inferral"
  | "nuclei_inferral"
  | "mitochondria_inferral"
  | "invisible";

// "materialize_volume_annotation" is only used in this module
const jobNameToImagePath = {
  neuron_inferral: "neuron_inferral_example.jpg",
  nuclei_inferral: "nuclei_inferral_example.jpg",
  mitochondria_inferral: "mito_inferral_example.jpg",
  align_sections: "align_example.png",
  materialize_volume_annotation: "materialize_volume_annotation_example.jpg",
  invisible: "",
  inference: "",
} as const;

type Props = {
  handleClose: () => void;
};

type StartAIJobModalProps = {
  aIJobModalState: StartAIJobModalState;
};

type JobApiCallArgsType = {
  newDatasetName: string;
  selectedLayer: APIDataLayer;
  selectedBoundingBox: UserBoundingBox | null | undefined;
  annotationId?: string;
  useCustomWorkflow?: boolean;
};
type StartJobFormProps = Props & {
  jobApiCall: (arg0: JobApiCallArgsType, form: FormInstance<any>) => Promise<void | APIJob>;
  jobName: keyof typeof jobNameToImagePath;
  description: React.ReactNode;
  isBoundingBoxConfigurable?: boolean;
  chooseSegmentationLayer?: boolean;
  suggestedDatasetSuffix: string;
  fixedSelectedLayer?: APIDataLayer | null | undefined;
  title: string;
  buttonLabel?: string | null;
  isSkeletonSelectable?: boolean;
  showWorkflowYaml?: boolean;
  jobCreditCostsPerGVx?: number;
};

type BoundingBoxSelectionProps = {
  isBoundingBoxConfigurable?: boolean;
  userBoundingBoxes: UserBoundingBox[];
  isSuperUser: boolean;
  showVolume: boolean;
  onChangeSelectedBoundingBox: (bBoxId: number | null) => void;
  value: number | null;
};

function renderUserBoundingBox(bbox: UserBoundingBox | null | undefined, showVolume: boolean) {
  if (!bbox) {
    return null;
  }

  const upscaledColor = bbox.color.map((colorPart) => colorPart * 255) as any as Vector3;
  const colorAsHexString = rgbToHex(upscaledColor);
  const volumeInVx = new BoundingBox(bbox.boundingBox).getVolume();
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
      {bbox.name} ({computeArrayFromBoundingBox(bbox.boundingBox).join(", ")}
      {showVolume ? `, ${formatVoxels(volumeInVx)}` : ""})
    </>
  );
}

function ExperimentalInferenceAlert() {
  return (
    <Alert
      message="Please note that this feature is experimental and currently only works with electron microscopy data.  If the specified bounding box is too close to the border of the dataset's bounding box, its size might be reduced automatically."
      type="warning"
      showIcon
    />
  );
}

export function BoundingBoxSelection({
  userBoundingBoxes,
  setSelectedBoundingBoxId,
  showVolume = false,
  style,
  value,
}: {
  userBoundingBoxes: UserBoundingBox[];
  setSelectedBoundingBoxId?: (boundingBoxId: number | null) => void;
  showVolume?: boolean;
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
          {renderUserBoundingBox(userBB, showVolume)}
        </Select.Option>
      ))}
    </Select>
  );
}

function BoundingBoxSelectionFormItem({
  isBoundingBoxConfigurable,
  userBoundingBoxes,
  isSuperUser,
  showVolume = false,
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
              if (!isBoundingBoxConfigurable || isSuperUser) return Promise.resolve();

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
          showVolume={showVolume}
        />
      </Form.Item>
    </div>
  );
}

export function MagSlider({
  magnificationInfo,
  value,
  onChange,
}: {
  magnificationInfo: MagInfo;
  value: Vector3;
  onChange: (v: Vector3) => void;
}) {
  // Use `getMagsWithIndices` because returns a sorted list
  const allMags = magnificationInfo.getMagsWithIndices();

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
      onWheelDisabled
    />
  );
}

export function StartAIJobModal({ aIJobModalState }: StartAIJobModalProps) {
  const onClose = () => Store.dispatch(setAIJobModalStateAction("invisible"));
  const isSuperUser = useSelector((state: OxalisState) => state.activeUser?.isSuperUser || false);
  const tabs = _.compact([
    {
      label: "Run a model",
      key: "runModel",
      children: <RunAiModelTab aIJobModalState={aIJobModalState} />,
    },
    isSuperUser
      ? {
          label: "Train a model",
          key: "trainModel",
          children: <TrainAiModelFromAnnotationTab onClose={onClose} />,
        }
      : null,
    {
      label: "Alignment",
      key: "alignment",
      children: <AlignmentTab />,
    },
  ]);
  return aIJobModalState !== "invisible" ? (
    <Modal
      width={875}
      open
      title={
        <>
          <i className="fas fa-magic icon-margin-right" />
          AI Analysis
        </>
      }
      onCancel={onClose}
      footer={null}
    >
      <Tabs items={tabs} />
    </Modal>
  ) : null;
}

function RunAiModelTab({ aIJobModalState }: { aIJobModalState: string }) {
  const centerImageStyle = {
    margin: "auto",
    width: 220,
  };
  const isSuperUser = Store.getState().activeUser?.isSuperUser || false;
  const [showCustomAiModels, setShowCustomAiModels] = useState(false);
  const dispatch = useDispatch();

  return (
    <Space direction="vertical" size="middle">
      <Row>
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <div className="flex-item">
            {showCustomAiModels
              ? "Choose one of your trained models from the list below."
              : "Choose a processing job for your dataset:"}
          </div>
          {isSuperUser && (
            <div className="flex-item" style={{ flexGrow: 0 }}>
              <Tooltip title="Switch between default and custom models">
                <Switch
                  checkedChildren="Custom"
                  unCheckedChildren="Default"
                  checked={showCustomAiModels}
                  disabled={!isSuperUser}
                  style={{
                    marginBottom: 6,
                  }}
                  onChange={(bool) => {
                    setShowCustomAiModels(bool);
                  }}
                />
              </Tooltip>
            </div>
          )}
        </div>
      </Row>

      {showCustomAiModels ? (
        <CustomAiModelInferenceForm />
      ) : (
        <>
          <Space align="center">
            <Radio.Button
              className="aIJobSelection"
              checked={aIJobModalState === "neuron_inferral"}
              onClick={() => dispatch(setAIJobModalStateAction("neuron_inferral"))}
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
            <Tooltip title={!isSuperUser ? "Coming soon" : null}>
              <Radio.Button
                className="aIJobSelection"
                disabled={!isSuperUser}
                checked={aIJobModalState === "mitochondria_inferral"}
                onClick={() => dispatch(setAIJobModalStateAction("mitochondria_inferral"))}
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
            <Tooltip title="Coming soon">
              <Radio.Button
                className="aIJobSelection"
                disabled
                checked={aIJobModalState === "nuclei_inferral"}
                onClick={() => dispatch(setAIJobModalStateAction("nuclei_inferral"))}
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
          </Space>
          {aIJobModalState === "neuron_inferral" ? <NeuronSegmentationForm /> : null}
          {aIJobModalState === "nuclei_inferral" ? <NucleiDetectionForm /> : null}
          {aIJobModalState === "mitochondria_inferral" ? <MitochondriaSegmentationForm /> : null}
          {aIJobModalState === "align_sections" ? <AlignSectionsForm /> : null}
        </>
      )}
    </Space>
  );
}

function AlignmentTab() {
  const centerImageStyle = {
    margin: "auto",
    width: 220,
  };
  return (
    <div>
      <div className="centered-items">
        <Space align="center">
          <Radio.Button className="aIJobSelection" checked={true}>
            <Card bordered={false}>
              <Space direction="vertical" size="small">
                <Row className="ai-job-title">Align Sections</Row>
                <Row>
                  <img
                    src={`/assets/images/${jobNameToImagePath.align_sections}`}
                    alt={"Example of improved alignment of slices"}
                    style={centerImageStyle}
                  />
                </Row>
              </Space>
            </Card>
          </Radio.Button>
        </Space>
      </div>
      <AlignSectionsForm />
    </div>
  );
}

function ShouldUseTreesFormItem() {
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const trees = tracing.skeleton ? Object.values(tracing.skeleton.trees) : [];
  return (
    <div>
      <Form.Item
        name="useAnnotation"
        label={
          <Space>
            <div style={{}}>
              Manual Matches{" "}
              <Tooltip title="Please select whether the alignment should take connected skeleton nodes between adjacent sections as alignment guideline whenever available.">
                <InfoCircleOutlined />
              </Tooltip>
            </div>
          </Space>
        }
        valuePropName="checked"
        rules={[
          {
            validator: (_rule, checked) => {
              if (checked) {
                if (tracing.annotationId === "") {
                  return Promise.reject(
                    "No annotation was found. Please create an annotation first.",
                  );
                }
                if (
                  tracing.skeleton == null ||
                  trees.filter((tree) => tree.edges.edgeCount > 0).length === 0
                ) {
                  return Promise.reject(
                    "No skeleton edges were found. Please create a skeleton with at least one edge first.",
                  );
                }
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Checkbox> Use manual matches from skeleton. </Checkbox>
      </Form.Item>
    </div>
  );
}

function calculateJobCosts(
  jobCreditCostsPerGVx: number,
  selectedBoundingBox: UserBoundingBox | undefined,
) {
  const currentBoundingBoxVolume = selectedBoundingBox?.boundingBox
    ? new BoundingBox(selectedBoundingBox?.boundingBox).getVolume()
    : null;
  const jobCosts =
    jobCreditCostsPerGVx != null && currentBoundingBoxVolume != null
      ? (currentBoundingBoxVolume / 1e9) * jobCreditCostsPerGVx
      : null;
  const jobCostsAsString = jobCosts != null ? (Math.ceil(jobCosts * 100) / 100).toFixed(2) : "";
  return { jobCosts, jobCostsAsString, currentBoundingBoxVolume };
}

function JobCostInformation({
  jobCreditCostsPerGVx,
  isBoundingBoxConfigurable,
  selectedBoundingBox,
  isOrganizationOwner,
}: {
  jobCreditCostsPerGVx: number;
  isBoundingBoxConfigurable: boolean;
  selectedBoundingBox: UserBoundingBox | undefined;
  isOrganizationOwner: boolean;
}) {
  const organizationCredits = useSelector(
    (state: OxalisState) => state.activeOrganization?.creditBalance || 0,
  );
  const { jobCosts, jobCostsAsString, currentBoundingBoxVolume } = calculateJobCosts(
    jobCreditCostsPerGVx,
    selectedBoundingBox,
  );
  const orgaHasEnoughCredits = jobCosts ? organizationCredits >= jobCosts : true;
  return (
    <>
      <Row style={{ display: "grid", marginBottom: 16 }}>
        <Alert
          message={
            <>
              This is a credit-based paid job. The costs depend on the{" "}
              {isBoundingBoxConfigurable
                ? "selected bounding box."
                : "bounding box of the selected dataset."}
              <br />
              This job costs {jobCreditCostsPerGVx} WEBKNOSSOS credits per Gigavoxel. Your
              organization currently has {organizationCredits} WEBKNOSSOS credits.
              <br />
              {currentBoundingBoxVolume != null
                ? `${isBoundingBoxConfigurable ? "The selected bounding box" : "This dataset"} has a volume of ${formatVoxels(currentBoundingBoxVolume)} resulting in costs of ${jobCostsAsString} WEBKNOSSOS credits.`
                : "You do not have a bounding box selected."}
            </>
          }
          type="info"
          showIcon
        />
      </Row>
      {jobCosts != null && !orgaHasEnoughCredits ? (
        <div style={{ marginBottom: 42 }}>
          <Form.Item
            name="requireBoundingBoxForPaidJobs"
            valuePropName="checked"
            rules={[
              {
                validator: (_rule, _checked) => {
                  if (jobCreditCostsPerGVx != null && currentBoundingBoxVolume == null) {
                    return Promise.reject(
                      "This is a paid job which needs a selected bounding box .",
                    );
                  } else if (jobCreditCostsPerGVx != null && !orgaHasEnoughCredits) {
                    return Promise.reject(
                      "Your organization does not have enough credits to start this job.",
                    );
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Row>
              <Alert
                message={
                  isOrganizationOwner ? (
                    <>
                      Your organization does not have enough credits to start this job. You can
                      order more credits !here!{" "}
                    </>
                  ) : (
                    "Your organization does not have enough credits to start this job. Please contact the organization owner to purchase more WEBKNOSSOS credits."
                  )
                }
                type="error"
                showIcon
              />
            </Row>
          </Form.Item>
        </div>
      ) : null}
    </>
  );
}

function StartJobForm(props: StartJobFormProps) {
  const isBoundingBoxConfigurable = props.isBoundingBoxConfigurable || false;
  const isSkeletonSelectable = props.isSkeletonSelectable || false;
  const chooseSegmentationLayer = props.chooseSegmentationLayer || false;
  const {
    handleClose,
    jobName,
    jobApiCall,
    fixedSelectedLayer,
    title,
    description,
    jobCreditCostsPerGVx,
  } = props;
  const [form] = Form.useForm();
  const rawUserBoundingBoxes = useSelector((state: OxalisState) =>
    getUserBoundingBoxesFromState(state),
  );

  const dispatch = useDispatch();
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isActiveUserSuperUser = activeUser?.isSuperUser || false;
  const colorLayers = getColorLayers(dataset);
  const layers = chooseSegmentationLayer ? getSegmentationLayers(dataset) : colorLayers;
  const [useCustomWorkflow, setUseCustomWorkflow] = React.useState(false);
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
  const selectedBoundingBoxId = Form.useWatch("boundingBoxId", form);
  const selectedBoundingBox = isBoundingBoxConfigurable
    ? userBoundingBoxes.find((bbox) => bbox.id === selectedBoundingBoxId)
    : userBoundingBoxes.length === 1
      ? userBoundingBoxes[0]
      : undefined;
  const { jobCosts, jobCostsAsString } =
    jobCreditCostsPerGVx != null && selectedBoundingBox != null
      ? calculateJobCosts(jobCreditCostsPerGVx, selectedBoundingBox)
      : { jobCosts: null, jobCostsAsString: "" };

  const startJob = async ({
    layerName,
    boundingBoxId,
    name: newDatasetName,
    useAnnotation,
  }: {
    layerName: string;
    boundingBoxId: number;
    name: string;
    useAnnotation: boolean;
  }) => {
    const selectedLayer = layers.find((layer) => layer.name === layerName);
    if (selectedLayer?.elementClass === "uint24") {
      const errorMessage =
        "AI analysis jobs can not be started for color layers with the data type uInt24. Please select a color layer with another data type.";
      Toast.error(errorMessage);
      console.error(errorMessage);
      return;
    }
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
        newDatasetName,
        selectedLayer,
        selectedBoundingBox,
        annotationId: useAnnotation ? tracing.annotationId : undefined,
        useCustomWorkflow,
      };
      const apiJob = await jobApiCall(jobArgs, form);

      if (!apiJob) {
        return;
      }
      if (jobCreditCostsPerGVx != null && activeUser?.organization) {
        // As the job did cost credits, refetch the organization to have a correct credit balance.
        const updatedOrganization = await getOrganization(activeUser?.organization);
        dispatch(setActiveOrganizationAction(updatedOrganization));
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
  if (fixedSelectedLayer) {
    initialLayerName = fixedSelectedLayer.name;
  }
  return (
    <Form
      onFinish={startJob}
      layout="vertical"
      initialValues={{
        layerName: initialLayerName,
        boundingBoxId: null,
        workflowYaml: DEFAULT_PREDICT_WORKFLOW,
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
        name="layerName"
        chooseSegmentationLayer={chooseSegmentationLayer}
        label={chooseSegmentationLayer ? "Segmentation Layer" : "Image data layer"}
        layers={layers}
        fixedLayerName={fixedSelectedLayer?.name}
        getReadableNameForLayer={(layer) =>
          getReadableNameOfVolumeLayer(layer, tracing) || layer.name
        }
      />
      <BoundingBoxSelectionFormItem
        isBoundingBoxConfigurable={isBoundingBoxConfigurable}
        userBoundingBoxes={userBoundingBoxes}
        isSuperUser={isActiveUserSuperUser}
        onChangeSelectedBoundingBox={(bBoxId) => form.setFieldsValue({ boundingBoxId: bBoxId })}
        value={form.getFieldValue("boundingBoxId")}
        showVolume={jobCreditCostsPerGVx != null}
      />
      {isSkeletonSelectable && <ShouldUseTreesFormItem />}
      {props.showWorkflowYaml ? (
        <CollapsibleWorkflowYamlEditor
          isActive={useCustomWorkflow}
          setActive={setUseCustomWorkflow}
        />
      ) : null}
      {jobCreditCostsPerGVx != null ? (
        <JobCostInformation
          jobCreditCostsPerGVx={jobCreditCostsPerGVx}
          isBoundingBoxConfigurable={isBoundingBoxConfigurable}
          selectedBoundingBox={selectedBoundingBox}
          isOrganizationOwner={isActiveUserSuperUser}
        />
      ) : null}
      <div style={{ textAlign: "center" }}>
        <Button type="primary" size="large" htmlType="submit">
          {props.buttonLabel ? props.buttonLabel : title}
          {jobCosts != null ? ` for ${jobCostsAsString} credits` : ""}
        </Button>
      </div>
    </Form>
  );
}

export function NucleiDetectionForm() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const dispatch = useDispatch();
  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      buttonLabel="Start AI nuclei detection"
      jobName={"nuclei_inferral"}
      title="AI Nuclei Segmentation"
      suggestedDatasetSuffix="with_nuclei"
      jobApiCall={async ({ newDatasetName, selectedLayer: colorLayer }) =>
        startNucleiInferralJob(dataset.id, colorLayer.name, newDatasetName)
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
              with EM data and a magnification of approximately 200{ThinSpace}nm per voxel. The
              segmentation process will automatically use the magnification that matches that
              magnification best.
            </b>
          </p>
        </>
      }
    />
  );
}
export function NeuronSegmentationForm() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const { neuronInferralCostsPerGVx } = features();
  const dispatch = useDispatch();
  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName={"neuron_inferral"}
      buttonLabel="Start AI neuron segmentation"
      title="AI Neuron Segmentation"
      suggestedDatasetSuffix="with_reconstructed_neurons"
      isBoundingBoxConfigurable
      jobCreditCostsPerGVx={neuronInferralCostsPerGVx}
      jobApiCall={async ({ newDatasetName, selectedLayer: colorLayer, selectedBoundingBox }) => {
        if (!selectedBoundingBox) {
          return;
        }

        const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
        return startNeuronInferralJob(dataset.id, colorLayer.name, bbox, newDatasetName);
      }}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row>
              This job will automatically detect and segment all neurons in this dataset. The AI
              will create a copy of this dataset containing the new neuron segmentation.
            </Row>
            <Row style={{ display: "grid", marginBottom: 16 }}>
              <ExperimentalInferenceAlert />
            </Row>
          </Space>
        </>
      }
    />
  );
}

export function MitochondriaSegmentationForm() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const { mitochondriaInferralCostsPerGVx } = features();
  const dispatch = useDispatch();
  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName={"mitochondria_inferral"}
      buttonLabel="Start AI mitochondria segmentation"
      title="AI Mitochondria Segmentation"
      suggestedDatasetSuffix="with_mitochondria_detected"
      isBoundingBoxConfigurable
      jobCreditCostsPerGVx={mitochondriaInferralCostsPerGVx}
      jobApiCall={async ({ newDatasetName, selectedLayer: colorLayer, selectedBoundingBox }) => {
        if (!selectedBoundingBox) {
          return;
        }

        const bbox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
        return startMitochondriaInferralJob(dataset.id, colorLayer.name, bbox, newDatasetName);
      }}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row>
              This job will automatically detect and segment all mitochondria in this dataset. The
              AI will create a copy of this dataset containing the new mitochondria segmentation.
            </Row>
            <Row style={{ display: "grid", marginBottom: 16 }}>
              <ExperimentalInferenceAlert />
            </Row>
          </Space>
        </>
      }
    />
  );
}

function CustomAiModelInferenceForm() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const annotationId = useSelector((state: OxalisState) => state.tracing.annotationId);
  const isViewMode = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const dispatch = useDispatch();

  const [aiModels, isLoading] = useGuardedFetch(
    async function () {
      const models = await getAiModels();
      return models.filter(
        (aiModel) => aiModel.trainingJob == null || aiModel.trainingJob.state === "SUCCESS",
      );
    },
    [],
    [],
    "Could not load model list.",
  );

  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName="inference"
      buttonLabel="Start inference with custom AI model"
      title="AI Inference"
      suggestedDatasetSuffix="with_custom_model"
      isBoundingBoxConfigurable
      showWorkflowYaml
      jobApiCall={async (
        { newDatasetName, selectedLayer: colorLayer, selectedBoundingBox, useCustomWorkflow },
        form,
      ) => {
        if (!selectedBoundingBox) {
          return;
        }

        const boundingBox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);

        const maybeAnnotationId = isViewMode ? {} : { annotationId };
        return runInferenceJob({
          ...maybeAnnotationId,
          aiModelId: form.getFieldValue("aiModel"),
          workflowYaml: useCustomWorkflow ? form.getFieldValue("workflowYaml") : undefined,
          datasetDirectoryName: dataset.directoryName,
          organizationId: dataset.owningOrganization,
          colorLayerName: colorLayer.name,
          boundingBox,
          newDatasetName: newDatasetName,
        });
      }}
      description={
        <>
          <Space direction="vertical" size="middle">
            <Row style={{ display: "grid", marginBottom: 16 }}>
              <ExperimentalInferenceAlert />
            </Row>
          </Space>
          <Form.Item
            name="aiModel"
            label="Model"
            hasFeedback
            validateFirst
            rules={[{ required: true }]}
          >
            <Select
              loading={isLoading}
              options={aiModels.map((aiModel) => ({ value: aiModel.id, label: aiModel.name }))}
            />
          </Form.Item>
        </>
      }
    />
  );
}

export function AlignSectionsForm() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const dispatch = useDispatch();
  const { alignmentCostsPerGVx } = features();
  return (
    <StartJobForm
      handleClose={() => dispatch(setAIJobModalStateAction("invisible"))}
      jobName={"align_sections"}
      buttonLabel="Start section alignment job"
      title="Section Alignment"
      suggestedDatasetSuffix="aligned"
      isBoundingBoxConfigurable={false}
      isSkeletonSelectable={true}
      jobApiCall={async ({ newDatasetName, selectedLayer: colorLayer, annotationId }) =>
        startAlignSectionsJob(dataset.id, colorLayer.name, newDatasetName, annotationId)
      }
      jobCreditCostsPerGVx={alignmentCostsPerGVx}
      description={
        <Space direction="vertical" size="middle">
          <Row>
            This job will automatically align all the sections of the dataset. If you want to align
            a dataset with multiple tiles per section, please contact us.
          </Row>
          <Row style={{ display: "grid", marginBottom: 16 }}>
            <Alert
              message="Please note that this feature is still experimental. Contact us if you have any problems or need alignment errors to be fixed."
              type="warning"
              showIcon
            />
          </Row>
        </Space>
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
  let includesEditableMapping = false;
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
        jobName={"materialize_volume_annotation"}
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
