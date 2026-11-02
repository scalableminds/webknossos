import { InfoCircleOutlined } from "@ant-design/icons";
import { Select, Switch } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { localeCompareBy } from "libs/utils";
import { useCallback, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import {
  getAgglomerateDiffOverlay,
  getAgglomerateDiffReferenceMappingName,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import { getSegmentationLayerByName } from "viewer/model/accessors/dataset_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setAgglomerateDiffsVisibilityAction } from "viewer/model/actions/agglomerate_diff_actions";
import { dispatchEnsureLayerMappingsAreLoadedAsync } from "viewer/model/actions/dataset_actions";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";

const explanation =
  "When a reference agglomerate view is selected, loading an agglomerate skeleton of this layer also loads " +
  "the edges that were added (green) and removed (orange) compared to the reference agglomerate that contains the clicked segment. " +
  "Added edges include all parts that were merged onto it. Removed edges that lead out of the agglomerate (splits) end at the first segment outside of it. " +
  "The selected reference view is remembered for this annotation. The differences themselves are not saved in the annotation " +
  "and are not shown for agglomerate skeletons of a proofread (editable) mapping.";

function useDiffSummary(layerName: string): string | null {
  const diffs = useWkSelector((state) => getAgglomerateDiffOverlay(state).diffs);
  return useMemo(() => {
    const diffsOfLayer = Object.values(diffs).filter((diff) => diff.layerName === layerName);
    if (diffsOfLayer.length === 0) return null;
    const loadedDiffs = diffsOfLayer.filter((diff) => diff.status === "loaded");
    const loadingCount = diffsOfLayer.filter((diff) => diff.status === "loading").length;
    const failedCount = diffsOfLayer.filter((diff) => diff.status === "failed").length;
    const addedEdgeCount = loadedDiffs.reduce((acc, diff) => acc + diff.addedEdgeCount, 0);
    const removedEdgeCount = loadedDiffs.reduce((acc, diff) => acc + diff.removedEdgeCount, 0);
    return [
      `${loadedDiffs.length} agglomerate${loadedDiffs.length === 1 ? "" : "s"} compared: +${addedEdgeCount} / −${removedEdgeCount} edges`,
      loadingCount > 0 ? `${loadingCount} loading` : null,
      failedCount > 0 ? `${failedCount} failed` : null,
    ]
      .filter((part) => part != null)
      .join(", ");
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
  const diffSummary = useDiffSummary(layerName);

  const ensureAgglomeratesAreLoaded = useCallback(
    async (isOpen: boolean) => {
      if (!isOpen || segmentationLayer.agglomerates != null) return;
      setIsLoadingAgglomerates(true);
      await dispatchEnsureLayerMappingsAreLoadedAsync(dispatch, segmentationLayer.name);
      setIsLoadingAgglomerates(false);
    },
    [dispatch, segmentationLayer],
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

  const options = useMemo(
    () =>
      (segmentationLayer.agglomerates ?? [])
        .slice()
        .sort(localeCompareBy((s) => s))
        .map((agglomerate) => ({ value: agglomerate, label: agglomerate })),
    [segmentationLayer.agglomerates],
  );

  if (!hasSkeleton) return null;

  return (
    <div style={{ marginBottom: 14 }}>
      <label className="setting-label">
        Reference Agglomerate View{" "}
        <FastTooltip title={explanation}>
          <InfoCircleOutlined />
        </FastTooltip>
      </label>
      <Select
        placeholder="No agglomerate diff"
        style={{ width: "100%", marginTop: 6 }}
        value={referenceMappingName ?? undefined}
        onChange={handleChange}
        onOpenChange={ensureAgglomeratesAreLoaded}
        loading={isLoadingAgglomerates}
        allowClear
        notFoundContent="No agglomerate views found."
        popupMatchSelectWidth={false}
        options={options}
      />
      {referenceMappingName != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <Switch
            size="small"
            checked={areDiffsVisible}
            onChange={(isVisible) => dispatch(setAgglomerateDiffsVisibilityAction(isVisible))}
          />
          <span>{diffSummary ?? "Load an agglomerate skeleton to compare it."}</span>
        </div>
      )}
    </div>
  );
}
