import {
  getFeatureNotAvailableInPlanMessage,
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { getJobs, startComputeMeshFileJob } from "admin/rest_api";
import { Button, Flex, Select, Space, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { usePolling, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { APIJobCommand } from "types/api_types";
import { MappingStatusEnum } from "viewer/constants";
import {
  getMagInfoOfVisibleSegmentationLayer,
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { hasEditableMapping } from "viewer/model/accessors/volumetracing_accessor";
import { updateTemporarySettingAction } from "viewer/model/actions/settings_actions";
import Store from "viewer/store";
import { formatMagWithLabel, getBaseSegmentationName } from "./segments_view_helper";

const { Option } = Select;
const REFRESH_INTERVAL = 5000;

type PrecomputeMeshesPopoverProps = {
  onActiveJobChange?: (isRunning: boolean) => void;
};

export const PrecomputeMeshesPopover = ({ onActiveJobChange }: PrecomputeMeshesPopoverProps) => {
  const dispatch = useDispatch();
  const [activeMeshJobId, setActiveMeshJobId] = useState<string | null>(null);

  const activeOrganization = useWkSelector((state) => state.activeOrganization);
  const activeUser = useWkSelector((state) => state.activeUser);
  const dataset = useWkSelector((state) => state.dataset);
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const hasVolumeTracing = useWkSelector((state) => state.annotation.volumes.length > 0);
  const preferredQualityForMeshPrecomputation = useWkSelector(
    (state) => state.temporaryConfiguration.preferredQualityForMeshPrecomputation,
  );
  const magInfo = useWkSelector(getMagInfoOfVisibleSegmentationLayer);
  const mappingInfo = useWkSelector((state) =>
    getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer?.name,
    ),
  );

  const pollJobData = useCallback(async () => {
    if (activeUser == null || activeMeshJobId == null) {
      return;
    }
    const jobs = await getJobs();
    const meshJobsForDataset = jobs.filter(
      (job: any) => job.command === "compute_mesh_file" && job.args.datasetName === dataset.name,
    );
    const activeJob = meshJobsForDataset.find((job: any) => job.id === activeMeshJobId);

    if (activeJob != null) {
      if (activeJob.state === "SUCCESS" || activeJob.state === "FAILURE") {
        setActiveMeshJobId(null);
      }
    }
  }, [activeUser, activeMeshJobId, dataset.name]);

  usePolling(pollJobData, activeMeshJobId != null ? REFRESH_INTERVAL : null);

  useEffect(() => {
    if (onActiveJobChange != null) {
      onActiveJobChange(activeMeshJobId != null);
    }
  }, [activeMeshJobId, onActiveJobChange]);

  const getTooltipInfo = () => {
    let title = "";
    let disabled = true;

    if (!isFeatureAllowedByPricingPlan(activeOrganization, PricingPlanEnum.Team)) {
      return {
        disabled: true,
        title: getFeatureNotAvailableInPlanMessage(
          PricingPlanEnum.Team,
          activeOrganization,
          activeUser,
        ),
      };
    }

    if (
      !dataset.dataStore.jobsSupportedByAvailableWorkers.includes(APIJobCommand.COMPUTE_MESH_FILE)
    ) {
      title = "Mesh computation jobs are not enabled for this WEBKNOSSOS instance.";
    } else if (activeUser == null) {
      title = "Please log in to precompute the meshes of this dataset.";
    } else if (!dataset.dataStore.jobsEnabled) {
      title =
        "Meshes Computation is not supported for datasets that are not natively hosted on the server. Upload your dataset directly to webknossos.org to use this feature.";
    } else if (hasVolumeTracing) {
      title = visibleSegmentationLayer?.fallbackLayer
        ? "Meshes cannot be precomputed for volume annotations. However, you can open this dataset in view mode to precompute meshes for the dataset's segmentation layer."
        : "Meshes cannot be precomputed for volume annotations.";
    } else if (visibleSegmentationLayer == null) {
      title = "There is no segmentation layer for which meshes could be precomputed.";
    } else {
      title =
        "Precompute meshes for all segments of this dataset so that meshes for segments can be loaded quickly afterwards from a mesh file.";
      disabled = false;
    }

    return {
      disabled,
      title,
    };
  };

  const { disabled, title } = getTooltipInfo();

  const startComputingMeshFile = async () => {
    const defaultOrHigherIndex = magInfo.getIndexOrClosestHigherIndex(
      preferredQualityForMeshPrecomputation,
    );
    const meshFileMagIndex =
      defaultOrHigherIndex != null
        ? defaultOrHigherIndex
        : magInfo.getClosestExistingIndex(preferredQualityForMeshPrecomputation);
    const meshFileMag = magInfo.getMagByIndexWithFallback(meshFileMagIndex, null);

    if (visibleSegmentationLayer != null) {
      const isEditableMapping = hasEditableMapping(Store.getState(), visibleSegmentationLayer.name);

      const maybeMappingName =
        !isEditableMapping &&
        mappingInfo.mappingStatus !== MappingStatusEnum.DISABLED &&
        mappingInfo.mappingType !== "JSON" &&
        mappingInfo.mappingName != null
          ? mappingInfo.mappingName
          : undefined;

      const job = await startComputeMeshFileJob(
        dataset.id,
        getBaseSegmentationName(visibleSegmentationLayer),
        meshFileMag,
        maybeMappingName,
      );
      setActiveMeshJobId(job.id);
      Toast.info(
        <Fragment>
          The computation of a mesh file was started. For large datasets, this may take a while.
          Closing this tab will not stop the computation.
          <br />
          See{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          for an overview of running jobs.
        </Fragment>,
      );
    }
  };

  const handleQualityChange = (magIndex: number) =>
    dispatch(updateTemporarySettingAction("preferredQualityForMeshPrecomputation", magIndex));

  return (
    <div
      style={{
        maxWidth: 500,
      }}
    >
      <Typography.Title level={4}>Precompute Meshes</Typography.Title>

      <Typography.Paragraph>
        Mesh visualizations help explore segmentations. WEBKNOSSOS can precompute all meshes for a
        layer so they load instantly once finished. Alternatively, use ad-hoc mesh generation for
        immediate results without precomputation, although it is slower.{" "}
        <a
          href="https://docs.webknossos.org/webknossos/meshes/index.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn more.
        </a>
      </Typography.Paragraph>

      <Typography.Paragraph>
        <Space>
          <FastTooltip title="The higher the quality, the more computational resources are required">
            Quality for Mesh Precomputation:
          </FastTooltip>
          <Select
            size="small"
            style={{ width: 220 }}
            value={magInfo.getClosestExistingIndex(preferredQualityForMeshPrecomputation)}
            onChange={handleQualityChange}
          >
            {magInfo.getMagsWithIndices().map(([logToIndex, mag], index) => (
              <Option value={logToIndex} key={logToIndex}>
                {formatMagWithLabel(mag, index)}
              </Option>
            ))}
          </Select>
        </Space>
      </Typography.Paragraph>

      <Flex justify="center">
        <FastTooltip title={title}>
          <Button
            loading={activeMeshJobId != null}
            type="primary"
            disabled={disabled}
            onClick={startComputingMeshFile}
          >
            Precompute Meshes
          </Button>
        </FastTooltip>
      </Flex>
    </div>
  );
};
