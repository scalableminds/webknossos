import { DatasetNameFormItem } from "admin/dataset/dataset_components";
import { type JobCreditCostInfo, getJobCreditCost, getOrganization } from "admin/rest_api";
import { Button, Form, type FormInstance } from "antd";
import { LayerSelectionFormItem } from "components/layer_selection";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { computeArrayFromBoundingBox } from "libs/utils";
import React, { useCallback, useEffect, useMemo } from "react";
import { useDispatch } from "react-redux";
import type { APIDataLayer, APIJob, APIJobType } from "types/api_types";
import { getColorLayers, getSegmentationLayers } from "viewer/model/accessors/dataset_accessor";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import { getReadableNameOfVolumeLayer } from "viewer/model/accessors/volumetracing_accessor";
import {
  setActiveOrganizationAction,
  setActiveOrganizationsCreditBalance,
} from "viewer/model/actions/organization_actions";
import { Model } from "viewer/singletons";
import type { UserBoundingBox } from "viewer/store";
import { BoundingBoxSelectionFormItem } from "../components/bounding_box_selection_form_item";
import { CollapsibleWorkflowYamlEditor } from "../components/collapsible_workflow_yaml_editor";
import { JobCreditCostInformation } from "../components/job_credit_cost_information";
import { ShouldUseTreesFormItem } from "../components/should_use_trees_form_item";
import { useCurrentlySelectedBoundingBox } from "../hooks/use_currently_selected_bounding_box";
import DEFAULT_PREDICT_WORKFLOW from "../templates/default-predict-workflow-template";
import { getBoundingBoxesForLayers } from "../utils";

type Props = {
  handleClose: () => void;
};

export type JobApiCallArgsType = {
  newDatasetName: string;
  selectedLayer: APIDataLayer;
  selectedBoundingBox: UserBoundingBox | null | undefined;
  annotationId?: string;
  useCustomWorkflow?: boolean;
};
export type StartJobFormProps = Props & {
  jobApiCall: (arg0: JobApiCallArgsType, form: FormInstance<any>) => Promise<void | APIJob>;
  jobName: APIJobType;
  description: React.ReactNode;
  jobSpecificInputFields?: React.ReactNode | undefined;
  isBoundingBoxConfigurable?: boolean;
  chooseSegmentationLayer?: boolean;
  suggestedDatasetSuffix: string;
  fixedSelectedLayer?: APIDataLayer | null | undefined;
  title: string;
  buttonLabel?: string | null;
  isSkeletonSelectable?: boolean;
  showWorkflowYaml?: boolean;
  jobCreditCostPerGVx?: number;
};

export function StartJobForm(props: StartJobFormProps) {
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
    jobCreditCostPerGVx,
    jobSpecificInputFields,
  } = props;
  const [form] = Form.useForm();
  const rawUserBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));

  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const activeUser = useWkSelector((state) => state.activeUser);
  const isActiveUserSuperUser = activeUser?.isSuperUser || false;
  const colorLayers = getColorLayers(dataset);
  const organizationCredits = useWkSelector(
    (state) => state.activeOrganization?.creditBalanceInMillis || "0",
  );
  const layers = chooseSegmentationLayer ? getSegmentationLayers(dataset) : colorLayers;
  const [useCustomWorkflow, setUseCustomWorkflow] = React.useState(false);
  const defaultBBForLayers = useMemo(() => getBoundingBoxesForLayers(layers), [layers]);
  const userBoundingBoxes = defaultBBForLayers.concat(rawUserBoundingBoxes);
  const boundingBoxForJob = useCurrentlySelectedBoundingBox(
    userBoundingBoxes,
    defaultBBForLayers,
    layers,
    form,
    isBoundingBoxConfigurable,
  );
  const jobCreditCostInfo = useFetch<JobCreditCostInfo | undefined>(
    async () =>
      boundingBoxForJob && jobCreditCostPerGVx != null
        ? await getJobCreditCost(
            jobName,
            computeArrayFromBoundingBox(boundingBoxForJob.boundingBox),
          )
        : undefined,
    undefined,
    [boundingBoxForJob, jobName],
  );

  useEffect(() => {
    const newAmountOfCredits = jobCreditCostInfo?.organizationMilliCredits;
    if (newAmountOfCredits && organizationCredits !== newAmountOfCredits) {
      dispatch(setActiveOrganizationsCreditBalance(newAmountOfCredits));
    }
  }, [jobCreditCostInfo, dispatch, organizationCredits]);

  const startJob = useCallback(
    async ({
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
          annotationId: useAnnotation ? annotation.annotationId : undefined,
          useCustomWorkflow,
        };
        const apiJob = await jobApiCall(jobArgs, form);

        if (!apiJob) {
          return;
        }
        if (jobCreditCostPerGVx != null && activeUser?.organization) {
          // As the job did cost credits, refetch the organization to have a correct credit balance.
          try {
            const updatedOrganization = await getOrganization(activeUser?.organization);
            dispatch(setActiveOrganizationAction(updatedOrganization));
          } catch (error) {
            Toast.error(
              "There was an error while reloading the available credits. Consider reloading the page.",
            );
            console.error("Failed to refresh organization credits.", error);
          }
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
    },
    [
      layers,
      userBoundingBoxes,
      isBoundingBoxConfigurable,
      annotation.annotationId,
      useCustomWorkflow,
      jobApiCall,
      form,
      jobCreditCostPerGVx,
      activeUser,
      dispatch,
      jobName,
      handleClose,
    ],
  );

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
          getReadableNameOfVolumeLayer(layer, annotation) || layer.name
        }
      />
      <BoundingBoxSelectionFormItem
        isBoundingBoxConfigurable={isBoundingBoxConfigurable}
        userBoundingBoxes={userBoundingBoxes}
        isSuperUser={isActiveUserSuperUser}
        onChangeSelectedBoundingBox={(bBoxId) => form.setFieldsValue({ boundingBoxId: bBoxId })}
        value={form.getFieldValue("boundingBoxId")}
        showVolume={jobCreditCostPerGVx != null}
      />
      {jobSpecificInputFields}
      {isSkeletonSelectable && <ShouldUseTreesFormItem />}
      {props.showWorkflowYaml ? (
        <CollapsibleWorkflowYamlEditor
          isActive={useCustomWorkflow}
          setActive={setUseCustomWorkflow}
        />
      ) : null}
      {jobCreditCostPerGVx != null ? (
        <JobCreditCostInformation
          jobCreditCostPerGVx={jobCreditCostPerGVx}
          jobCreditCostInfo={jobCreditCostInfo}
        />
      ) : null}
      <div style={{ textAlign: "center" }}>
        <Button type="primary" size="large" htmlType="submit">
          {props.buttonLabel ? props.buttonLabel : title}
        </Button>
      </div>
    </Form>
  );
}
