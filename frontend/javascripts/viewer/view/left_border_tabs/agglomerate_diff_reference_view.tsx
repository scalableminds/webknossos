import { InfoCircleOutlined } from "@ant-design/icons";
import { Select } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { localeCompareBy } from "libs/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import {
  getAgglomerateDiffOverlay,
  getAgglomerateDiffReferenceMappingName,
  isAgglomerateDiffEnabled,
  isAgglomerateMappingEnabled,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import {
  getMappingInfo,
  getSegmentationLayerByName,
} from "viewer/model/accessors/dataset_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { hasEditableMapping } from "viewer/model/accessors/volumetracing_accessor";
import { dispatchEnsureLayerMappingsAreLoadedAsync } from "viewer/model/actions/dataset_actions";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import SwitchSetting from "./components/switch_setting";

const explanation =
  "When enabled, loading an agglomerate skeleton of this layer also loads the edges that were added (green) " +
  "and removed (orange) compared to the agglomerate of the reference view that contains the clicked segment.";

// Failures of many agglomerates usually have few distinct reasons, so only these are listed
const MAX_LISTED_FAILURE_REASONS = 5;

const pluralizeAgglomerates = (count: number) =>
  count === 1 ? "1 agglomerate" : `${count} agglomerates`;

function useDiffSummary(
  layerName: string,
): { summary: string; failedCount: number; failureReasons: string[] } | null {
  const diffs = useWkSelector((state) => getAgglomerateDiffOverlay(state).diffs);
  return useMemo(() => {
    const diffsOfLayer = Object.values(diffs).filter((diff) => diff.layerName === layerName);
    if (diffsOfLayer.length === 0) return null;
    const loadedCount = diffsOfLayer.filter((diff) => diff.status === "loaded").length;
    const loadingCount = diffsOfLayer.filter((diff) => diff.status === "loading").length;
    const failedDiffs = diffsOfLayer.filter((diff) => diff.status === "failed");
    const summary = [
      `${pluralizeAgglomerates(loadedCount)} compared`,
      loadingCount > 0 ? `${loadingCount} loading` : null,
    ]
      .filter((part) => part != null)
      .join(", ");
    const failureReasons = [
      ...new Set(
        failedDiffs.map((diff) => `Agglomerate ${diff.agglomerateId}: ${diff.errorMessage}`),
      ),
    ];
    return {
      summary,
      failedCount: failedDiffs.length,
      failureReasons:
        failureReasons.length > MAX_LISTED_FAILURE_REASONS
          ? [
              ...failureReasons.slice(0, MAX_LISTED_FAILURE_REASONS),
              `… and ${failureReasons.length - MAX_LISTED_FAILURE_REASONS} more`,
            ]
          : failureReasons,
    };
  }, [diffs, layerName]);
}

export default function AgglomerateDiffReferenceView({ layerName }: { layerName: string }) {
  const dispatch = useDispatch();
  const [isLoadingAgglomerates, setIsLoadingAgglomerates] = useState(false);
  const segmentationLayer = useWkSelector((state) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  const hasSkeleton = useWkSelector((state) => getSkeletonTracing(state.annotation) != null);
  const isEnabled = useWkSelector((state) => isAgglomerateDiffEnabled(state, layerName));
  const referenceMappingName = useWkSelector((state) =>
    getAgglomerateDiffReferenceMappingName(state, layerName),
  );
  const activeMappingName = useWkSelector(
    (state) =>
      getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName).mappingName,
  );
  const isProofreading = useWkSelector((state) => hasEditableMapping(state, layerName));
  const isAgglomerateMappingActive = useWkSelector((state) =>
    isAgglomerateMappingEnabled(state, layerName),
  );
  const diffSummary = useDiffSummary(layerName);

  const ensureAgglomeratesAreLoaded = useCallback(async () => {
    if (segmentationLayer.agglomerates != null) return;
    setIsLoadingAgglomerates(true);
    await dispatchEnsureLayerMappingsAreLoadedAsync(dispatch, segmentationLayer.name);
    setIsLoadingAgglomerates(false);
  }, [dispatch, segmentationLayer]);

  // Diffs are only computed while an agglomerate mapping is active (see agglomerate_diff_saga)
  const isShown = hasSkeleton && isAgglomerateMappingActive;
  // The agglomerate files are needed to know whether agglomerates can be compared at all
  const shouldLoadAgglomerates = isShown && !isProofreading;
  useEffect(() => {
    if (shouldLoadAgglomerates) ensureAgglomeratesAreLoaded();
  }, [shouldLoadAgglomerates, ensureAgglomeratesAreLoaded]);

  // The diffs of the layer's agglomerate skeletons are not computed in these cases (see
  // agglomerate_diff_saga), so the setting is ignored.
  const disabledReason = isProofreading
    ? "Agglomerate skeletons of a proofread (editable) mapping cannot be compared to a reference agglomerate view, yet."
    : segmentationLayer.agglomerates != null && segmentationLayer.agglomerates.length < 2
      ? "Comparing agglomerate skeletons requires at least two agglomerate views (agglomerate files) for this layer."
      : null;

  const handleToggle = useCallback(
    (newIsEnabled: boolean) => {
      dispatch(updateLayerSettingAction(layerName, "isAgglomerateDiffEnabled", newIsEnabled));
    },
    [dispatch, layerName],
  );

  const handleChange = useCallback(
    (newReferenceMappingName: string | undefined) => {
      // null instead of undefined, so that clearing the selection is saved, too
      dispatch(
        updateLayerSettingAction(
          layerName,
          "agglomerateDiffReference",
          newReferenceMappingName ?? null,
        ),
      );
    },
    [dispatch, layerName],
  );

  // Comparing the active agglomerate view to itself would show nothing
  const options = useMemo(
    () =>
      (segmentationLayer.agglomerates ?? [])
        .filter((agglomerate) => agglomerate !== activeMappingName)
        .sort(localeCompareBy((s) => s))
        .map((agglomerate) => ({ value: agglomerate, label: agglomerate })),
    [segmentationLayer.agglomerates, activeMappingName],
  );

  if (!isShown) return null;

  const isActive = isEnabled && disabledReason == null;
  const statusText =
    referenceMappingName != null && referenceMappingName === activeMappingName ? (
      "The reference is the active agglomerate view, so its agglomerate skeletons are not compared."
    ) : diffSummary != null ? (
      <>
        {diffSummary.summary}
        {diffSummary.failedCount > 0 && (
          <>
            ,{" "}
            <FastTooltip
              dynamicRenderer={() => (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {diffSummary.failureReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            >
              <span style={{ textDecoration: "underline dotted" }}>
                {diffSummary.failedCount} failed
              </span>
            </FastTooltip>
          </>
        )}
      </>
    ) : null;
  return (
    <div style={{ marginBottom: 14 }}>
      <SwitchSetting
        label={
          <>
            Compare to Reference{" "}
            <FastTooltip title={explanation}>
              <InfoCircleOutlined />
            </FastTooltip>
          </>
        }
        value={isActive}
        onChange={handleToggle}
        disabled={disabledReason != null}
        disabledReason={disabledReason}
        loading={isLoadingAgglomerates}
      />
      {isActive && (
        <>
          <Select
            placeholder="Select a reference agglomerate view"
            style={{ width: "100%" }}
            value={referenceMappingName ?? undefined}
            onChange={handleChange}
            loading={isLoadingAgglomerates}
            allowClear
            notFoundContent="No other agglomerate views found."
            popupMatchSelectWidth={false}
            options={options}
          />
          {statusText != null && <div style={{ marginTop: 6 }}>{statusText}</div>}
        </>
      )}
    </div>
  );
}
