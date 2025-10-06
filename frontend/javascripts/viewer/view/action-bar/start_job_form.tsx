import { DatasetNameFormItem } from "admin/dataset/dataset_components";
import { Button, Form, type FormInstance } from "antd";
import { LayerSelectionFormItem } from "components/layer_selection";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type React from "react";
import { useCallback, useMemo } from "react";
import type { APIDataLayer, APIJob, APIJobType } from "types/api_types";
import { getSegmentationLayers } from "viewer/model/accessors/dataset_accessor";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import { getReadableNameOfVolumeLayer } from "viewer/model/accessors/volumetracing_accessor";
import { Model } from "viewer/singletons";
import type { UserBoundingBox } from "viewer/store";
import { BoundingBoxSelectionFormItem } from "viewer/view/ai_jobs/components/bounding_box_selection_form_item";
import { getBoundingBoxesForLayers } from "viewer/view/ai_jobs/utils";

type Props = {
  handleClose: () => void;
};

export type JobApiCallArgsType = {
  newDatasetName: string;
  selectedLayer: APIDataLayer;
  selectedBoundingBox: UserBoundingBox | null | undefined;
};
export type StartJobFormProps = Props & {
  jobApiCall: (arg0: JobApiCallArgsType, form: FormInstance<any>) => Promise<void | APIJob>;
  jobName: APIJobType;
  description: React.ReactNode;
  isBoundingBoxConfigurable?: boolean;
  chooseSegmentationLayer?: boolean;

  suggestedDatasetSuffix: string;
  fixedSelectedLayer?: APIDataLayer | null | undefined;
  title: string;
};

export function StartJobForm(props: StartJobFormProps) {
  const isBoundingBoxConfigurable = props.isBoundingBoxConfigurable || false;
  const chooseSegmentationLayer = props.chooseSegmentationLayer || false;
  const { handleClose, jobName, jobApiCall, fixedSelectedLayer, title, description } = props;
  const [form] = Form.useForm();
  const rawUserBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));

  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);
  const activeUser = useWkSelector((state) => state.activeUser);
  const isActiveUserSuperUser = activeUser?.isSuperUser || false;
  const layers = getSegmentationLayers(dataset);
  const defaultBBForLayers = useMemo(() => getBoundingBoxesForLayers(layers), [layers]);
  const userBoundingBoxes = defaultBBForLayers.concat(rawUserBoundingBoxes);

  const startJob = useCallback(
    async ({
      layerName,
      boundingBoxId,
      name: newDatasetName,
    }: {
      layerName: string;
      boundingBoxId: number;
      name: string;
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
        };
        const apiJob = await jobApiCall(jobArgs, form);

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
    },
    [layers, userBoundingBoxes, isBoundingBoxConfigurable, jobName, jobApiCall, form, handleClose],
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
        showVolume={false}
      />
      <div style={{ textAlign: "center" }}>
        <Button type="primary" size="large" htmlType="submit">
          {title}
        </Button>
      </div>
    </Form>
  );
}
