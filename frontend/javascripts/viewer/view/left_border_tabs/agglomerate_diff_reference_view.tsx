import { InfoCircleOutlined } from "@ant-design/icons";
import { Select, Switch } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { localeCompareBy } from "libs/utils";
import messages from "messages";
import { useCallback, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { getAgglomerateDiffOverlay } from "viewer/model/accessors/agglomerate_diff_accessor";
import {
  isAnnotationOwner,
  isConcurrentCollaborationMode,
  mayEditAnnotation,
} from "viewer/model/accessors/annotation_accessor";
import { getSegmentationLayerByName } from "viewer/model/accessors/dataset_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setAgglomerateDiffsVisibilityAction } from "viewer/model/actions/agglomerate_diff_actions";
import { dispatchEnsureLayerMappingsAreLoadedAsync } from "viewer/model/actions/dataset_actions";
import { setAgglomerateDiffReferenceAction } from "viewer/model/actions/skeletontracing_actions";

const explanation =
  "When a reference agglomerate view is selected, loading an agglomerate skeleton of this layer also loads " +
  "the edges that were added (green) and removed (orange) compared to the reference agglomerate that contains the clicked segment. " +
  "Added edges include all parts that were merged onto it. Removed edges that lead out of the agglomerate (splits) end at the first segment outside of it. " +
  "The differences are not saved in the annotation and are not shown for agglomerate skeletons of a proofread (editable) mapping.";

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
  const referenceMappingName = useWkSelector(
    (state) =>
      getSkeletonTracing(state.annotation)?.agglomerateDiffReferences.find(
        (ref) => ref.layerName === layerName,
      )?.referenceMappingName ?? null,
  );
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const isCollabMode = useWkSelector(isConcurrentCollaborationMode);
  const isAnnotationLockedByOwner = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector(isAnnotationOwner);
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
      dispatch(setAgglomerateDiffReferenceAction(layerName, newReferenceMappingName ?? null));
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

  const disabledReason = !allowUpdate
    ? messages["tracing.read_only_mode_notification"](isAnnotationLockedByOwner, isOwner)
    : isCollabMode
      ? "The reference agglomerate view cannot be changed in live collaboration mode."
      : null;

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
          placeholder="No agglomerate diff"
          style={{ width: "100%", marginTop: 6 }}
          value={referenceMappingName ?? undefined}
          onChange={handleChange}
          onOpenChange={ensureAgglomeratesAreLoaded}
          loading={isLoadingAgglomerates}
          allowClear
          disabled={disabledReason != null}
          notFoundContent="No agglomerate views found."
          popupMatchSelectWidth={false}
          options={options}
        />
      </FastTooltip>
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
