import { useQuery } from "@tanstack/react-query";
import { useIsJobAvailable } from "admin/job/job_hooks";
import {
  areJobsAllowedByPricingPlan,
  getFeatureNotAvailableInPlanMessage,
  hasPricingPlanExceededStorage,
  isFeatureAllowedByPricingPlan,
  PricingPlanEnum,
} from "admin/organization/pricing_plan_utils";
import { getJobs, startComputeMeshFileJob } from "admin/rest_api";
import { Button, Flex, Select, Space, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { Fragment, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { APIJobCommand } from "types/api_types";
import {
  getMagInfoOfVisibleSegmentationLayer,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import { dispatchEnsureLayerMappingsAreLoadedAsync } from "viewer/model/actions/dataset_actions";
import { updateTemporarySettingAction } from "viewer/model/actions/settings_actions";
import { formatMagWithLabel, getBaseSegmentationName } from "./segments_view_helper";

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
  const isMeshFileJobAvailable = useIsJobAvailable(
    dataset.dataStore,
    APIJobCommand.COMPUTE_MESH_FILE,
  );
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const hasVolumeTracing = useWkSelector((state) => state.annotation.volumes.length > 0);
  const preferredQualityForMeshPrecomputation = useWkSelector(
    (state) => state.temporaryConfiguration.preferredQualityForMeshPrecomputation,
  );
  const magInfo = useWkSelector(getMagInfoOfVisibleSegmentationLayer);
  // Without a mapping by default: such a mesh file works with every mapping and for proofreading.
  const [agglomerateView, setAgglomerateView] = useState<string | null>(null);
  const [areMappingsLoading, setAreMappingsLoading] = useState(false);
  const visibleSegmentationLayerName = visibleSegmentationLayer?.name;

  useEffect(() => {
    // The mappings differ between layers.
    setAgglomerateView(null);
    // The agglomerate mappings of a layer are only fetched on demand. With a volume annotation,
    // meshes can't be precomputed anyway.
    if (visibleSegmentationLayerName == null || hasVolumeTracing) {
      return;
    }
    setAreMappingsLoading(true);
    dispatchEnsureLayerMappingsAreLoadedAsync(dispatch, visibleSegmentationLayerName).finally(() =>
      setAreMappingsLoading(false),
    );
  }, [dispatch, visibleSegmentationLayerName, hasVolumeTracing]);

  // Poll the jobs while a mesh job is running. Errors are swallowed so that a failing
  // poll doesn't show a toast every few seconds.
  const { data: jobs } = useQuery({
    // Separate key from the job list view, which uses different retry and persistence settings.
    queryKey: ["jobs", "meshJobPolling"],
    queryFn: () => getJobs(undefined, undefined, { showErrorToast: false }),
    enabled: activeUser != null && activeMeshJobId != null,
    refetchInterval: REFRESH_INTERVAL,
    retry: false,
    meta: { persist: false },
  });

  useEffect(() => {
    if (jobs == null || activeMeshJobId == null) {
      return;
    }
    const activeJob = jobs.find(
      (job) =>
        job.id === activeMeshJobId &&
        job.command === "compute_mesh_file" &&
        job.args.datasetName === dataset.name,
    );
    if (activeJob != null && (activeJob.state === "SUCCESS" || activeJob.state === "FAILURE")) {
      setActiveMeshJobId(null);
    }
  }, [jobs, activeMeshJobId, dataset.name]);

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

    if (!areJobsAllowedByPricingPlan(activeOrganization)) {
      return {
        disabled: true,
        title: "Meshes cannot be precomputed in the Open Source plan. Ad-hoc meshes are available.",
      };
    }

    if (activeOrganization != null && hasPricingPlanExceededStorage(activeOrganization)) {
      // The backend refuses to start the job in this case, as the mesh file could not be stored.
      return {
        disabled: true,
        title:
          "Your organization has exceeded the available storage. Therefore, meshes cannot be precomputed.",
      };
    }

    if (!isMeshFileJobAvailable) {
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
      const job = await startComputeMeshFileJob(
        dataset.id,
        getBaseSegmentationName(visibleSegmentationLayer),
        meshFileMag,
        agglomerateView ?? undefined,
      );
      setActiveMeshJobId(job.id);
      Toast.info(
        <Fragment>
          The computation of a mesh file was started. For large datasets, this may take a while. You
          can close this popover and continue working. Closing this tab won't stop the computation
          either.
          <br />
          Check the progress on the{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          page. You will also get an email when the mesh file is ready.
        </Fragment>,
        // The message is longer than usual and should not be missed.
        { timeout: 15000 },
      );
    }
  };

  const handleQualityChange = (magIndex: number) =>
    dispatch(updateTemporarySettingAction("preferredQualityForMeshPrecomputation", magIndex));

  const qualityOptions = magInfo.getMagsWithIndices().map(([logToIndex, mag], index) => ({
    value: logToIndex,
    label: formatMagWithLabel(mag, index),
  }));

  const mappingOptions = [
    { value: null, label: "None (recommended)" },
    ...(visibleSegmentationLayer?.agglomerates ?? []).map((name) => ({ value: name, label: name })),
  ];

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
            options={qualityOptions}
          />
        </Space>
      </Typography.Paragraph>

      <Typography.Paragraph>
        <Space>
          Mapping:
          <Select
            size="small"
            style={{ width: 220 }}
            value={agglomerateView}
            onChange={setAgglomerateView}
            loading={areMappingsLoading}
            options={mappingOptions}
          />
        </Space>
      </Typography.Paragraph>

      <Typography.Paragraph type="secondary">
        Not selecting a mapping is recommended, since this is the most flexible option. A mesh file
        computed without a mapping works with all mappings and is required for proofreading. Only
        select a mapping if you need the best loading performance for exactly that mapping.
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
