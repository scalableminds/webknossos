import { InfoCircleOutlined } from "@ant-design/icons";
import { Select, Switch } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { localeCompareBy } from "libs/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import {
  getAgglomerateDiffOverlay,
  getAgglomerateDiffReferenceMappingName,
  isAgglomerateMappingEnabled,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import { getSegmentationLayerByName } from "viewer/model/accessors/dataset_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { hasEditableMapping } from "viewer/model/accessors/volumetracing_accessor";
import { setAgglomerateDiffsVisibilityAction } from "viewer/model/actions/agglomerate_diff_actions";
import { dispatchEnsureLayerMappingsAreLoadedAsync } from "viewer/model/actions/dataset_actions";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";

const explanation =
  "When a reference agglomerate view is selected, loading an agglomerate skeleton of this layer also loads " +
  "the edges that were added (green) and removed (orange) compared to the reference agglomerate that contains the clicked segment.";

// Failures of many agglomerates usually have few distinct reasons, so only these are listed
const MAX_LISTED_FAILURE_REASONS = 5;

function useDiffSummary(
  layerName: string,
): { summary: string; failedCount: number; failureReasons: string[] } | null {
  const diffs = useWkSelector((state) => getAgglomerateDiffOverlay(state).diffs);
  return useMemo(() => {
    const diffsOfLayer = Object.values(diffs).filter((diff) => diff.layerName === layerName);
    if (diffsOfLayer.length === 0) return null;
    const loadedDiffs = diffsOfLayer.filter((diff) => diff.status === "loaded");
    const loadingCount = diffsOfLayer.filter((diff) => diff.status === "loading").length;
    const failedDiffs = diffsOfLayer.filter((diff) => diff.status === "failed");
    const addedEdgeCount = loadedDiffs.reduce((acc, diff) => acc + diff.addedEdgeCount, 0);
    const removedEdgeCount = loadedDiffs.reduce((acc, diff) => acc + diff.removedEdgeCount, 0);
    const summary = [
      `${loadedDiffs.length} agglomerate${loadedDiffs.length === 1 ? "" : "s"} compared: +${addedEdgeCount} / −${removedEdgeCount} edges`,
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
  const referenceMappingName = useWkSelector((state) =>
    getAgglomerateDiffReferenceMappingName(state, layerName),
  );
  const areDiffsVisible = useWkSelector((state) => getAgglomerateDiffOverlay(state).isVisible);
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
  // agglomerate_diff_saga), so a selected reference view is ignored.
  const disabledReason = isProofreading
    ? "Agglomerate skeletons of a proofread (editable) mapping cannot be compared to a reference agglomerate view, yet."
    : segmentationLayer.agglomerates != null && segmentationLayer.agglomerates.length < 2
      ? "Comparing agglomerate skeletons requires at least two agglomerate views (agglomerate files) for this layer."
      : null;

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

  const options = useMemo(
    () =>
      (segmentationLayer.agglomerates ?? [])
        .slice()
        .sort(localeCompareBy((s) => s))
        .map((agglomerate) => ({ value: agglomerate, label: agglomerate })),
    [segmentationLayer.agglomerates],
  );

  if (!isShown) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <label className="setting-label">
        Reference Agglomerate View{" "}
        <FastTooltip title={explanation}>
          <InfoCircleOutlined />
        </FastTooltip>
      </label>
      <FastTooltip title={disabledReason}>
        <Select
          placeholder={disabledReason != null ? "Not available" : "No agglomerate diff"}
          style={{ width: "100%", marginTop: 6 }}
          value={disabledReason != null ? undefined : (referenceMappingName ?? undefined)}
          onChange={handleChange}
          loading={isLoadingAgglomerates}
          disabled={disabledReason != null}
          allowClear
          notFoundContent="No agglomerate views found."
          popupMatchSelectWidth={false}
          options={options}
        />
      </FastTooltip>
      {referenceMappingName != null && disabledReason == null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <Switch
            size="small"
            checked={areDiffsVisible}
            onChange={(isVisible) => dispatch(setAgglomerateDiffsVisibilityAction(isVisible))}
          />
          <span>
            {diffSummary?.summary ?? "Load an agglomerate skeleton to compare it."}
            {diffSummary != null && diffSummary.failedCount > 0 && (
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
          </span>
        </div>
      )}
    </div>
  );
}
