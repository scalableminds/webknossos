import { Divider, Empty } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { getVisibleSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import {
  getActiveSegmentationTracing,
  getVisibleSegments,
} from "viewer/model/accessors/volumetracing_accessor";
import { ensureSegmentIndexIsLoadedAction } from "viewer/model/actions/dataset_actions";
import type { Segment } from "viewer/store";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import DeleteGroupModalView from "../delete_group_modal_view";
import { MISSING_GROUP_ID } from "../shared/tree_hierarchy_view_helpers";
import type { SegmentStatisticsTarget } from "./context_menus";
import { useMeshFiles } from "./hooks/use_mesh_files";
import { useMeshOperations } from "./hooks/use_mesh_operations";
import { useSegmentGroupOperations } from "./hooks/use_segment_group_operations";
import { useSegmentHierarchy } from "./hooks/use_segment_hierarchy";
import { useSegmentSelection } from "./hooks/use_segment_selection";
import { useSegmentStatisticsFile } from "./hooks/use_segment_statistics_file";
import { SegmentStatisticsModal } from "./segment_statistics_modal";
import { SegmentTreeView } from "./segment_tree_view";
import { SegmentsToolbar, segmentsTabId } from "./segments_toolbar";
import { mayEditVisibleSegmentation } from "./segments_view_helper";

function SegmentStatisticsModalContainer({
  target,
  onClose,
  getSegmentsOfGroupRecursively,
}: {
  target: SegmentStatisticsTarget;
  onClose: () => void;
  getSegmentsOfGroupRecursively: (groupId: number) => Segment[];
}) {
  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const activeVolumeTracing = useWkSelector(getActiveSegmentationTracing);
  const segmentGroups = useWkSelector((state) => getVisibleSegments(state).segmentGroups);

  if (visibleSegmentationLayer == null) {
    return null;
  }
  const segments =
    target.kind === "group" ? getSegmentsOfGroupRecursively(target.groupId) : target.segments;
  if (segments.length === 0) {
    return null;
  }

  return (
    <SegmentStatisticsModal
      onCancel={onClose}
      visibleSegmentationLayer={visibleSegmentationLayer}
      tracingId={activeVolumeTracing?.tracingId}
      relevantSegments={segments}
      csvFilenameSuffix={getCsvFilenameSuffix(target, segments)}
      segmentGroups={segmentGroups}
    />
  );
}

/** Distinguishes exports of the same layer from one another; the root group needs no suffix. */
function getCsvFilenameSuffix(target: SegmentStatisticsTarget, segments: Segment[]): string | null {
  if (target.kind === "group") {
    return target.groupId === MISSING_GROUP_ID ? null : `group-${target.groupId}`;
  }
  return segments.length === 1
    ? `segment-${segments[0].id}`
    : `${segments.length}-selected-segments`;
}

function SegmentsTabContent() {
  const dispatch = useDispatch();
  const hierarchy = useSegmentHierarchy();
  const selection = useSegmentSelection();
  const groupOperations = useSegmentGroupOperations();
  const meshOperations = useMeshOperations();
  const meshFiles = useMeshFiles();
  const [statisticsModalTarget, setStatisticsModalTarget] =
    useState<SegmentStatisticsTarget | null>(null);

  const visibleSegmentationLayer = useWkSelector(getVisibleSegmentationLayer);
  const allowUpdate = useWkSelector(mayEditVisibleSegmentation);
  const hasVolumeTracing = useWkSelector((state) => state.annotation.volumes.length > 0);
  // The hierarchy always contains the (virtual) root group node.
  const isSegmentHierarchyEmpty = hierarchy.flatNodes.length <= 1;

  useEffect(() => {
    dispatch(ensureSegmentIndexIsLoadedAction(visibleSegmentationLayer?.name));
  }, [dispatch, visibleSegmentationLayer]);

  // Probed here rather than only where it is consumed, because the segment tree – and with it the
  // group context menu that gates on this – is not rendered while the segment list is empty.
  // The result is shared via the react-query cache, so consumers cause no extra request.
  useSegmentStatisticsFile(visibleSegmentationLayer);

  return (
    <>
      <SegmentsToolbar
        hierarchy={hierarchy}
        selection={selection}
        groupOperations={groupOperations}
        meshFiles={meshFiles}
      />
      <Divider size="small" />
      <div style={{ flex: 1 }}>
        {isSegmentHierarchyEmpty ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`There are no segments. ${
              allowUpdate && hasVolumeTracing
                ? "Use the volume tools (e.g., the brush) to create a segment. Alternatively, select or click existing segments to add them to this list."
                : "Select or click existing segments to add them to this list."
            }`}
          />
        ) : (
          <SegmentTreeView
            hierarchy={hierarchy}
            selection={selection}
            groupOperations={groupOperations}
            meshOperations={meshOperations}
            meshFiles={meshFiles}
            openStatisticsModal={setStatisticsModalTarget}
          />
        )}
      </div>
      {groupOperations.groupIdPendingDeletion != null ? (
        <DeleteGroupModalView
          onCancel={groupOperations.cancelGroupDeletion}
          onJustDeleteGroup={() => groupOperations.confirmGroupDeletion(false)}
          onDeleteGroupAndChildren={() => groupOperations.confirmGroupDeletion(true)}
        />
      ) : null}
      {statisticsModalTarget != null ? (
        <SegmentStatisticsModalContainer
          target={statisticsModalTarget}
          onClose={() => setStatisticsModalTarget(null)}
          getSegmentsOfGroupRecursively={groupOperations.getSegmentsOfGroupRecursively}
        />
      ) : null}
    </>
  );
}

export default function SegmentsTabView() {
  const hasVisibleSegmentationLayer = useWkSelector(
    (state) => getVisibleSegmentationLayer(state) != null,
  );

  return (
    <div id={segmentsTabId} className="padded-tab-content">
      <DomVisibilityObserver targetId={segmentsTabId}>
        {(isVisibleInDom) => {
          if (!isVisibleInDom) {
            return null;
          }
          if (!hasVisibleSegmentationLayer) {
            return (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No segmentation layer visible."
              />
            );
          }
          return <SegmentsTabContent />;
        }}
      </DomVisibilityObserver>
    </div>
  );
}
