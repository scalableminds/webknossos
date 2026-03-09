import { SimpleRow } from "dashboard/folders/metadata_table";
import sum from "lodash-es/sum";
import type React from "react";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import type { APIDataLayer, MetadataEntryProto } from "types/api_types";
import { updateSegmentAction } from "viewer/model/actions/volumetracing_actions";
import { api } from "viewer/singletons";
import type { Segment, SegmentGroup } from "viewer/store";
import { InputWithUpdateOnBlur } from "viewer/view/components/input_with_update_on_blur";
import { MetadataEntryTableRows } from "viewer/view/right_border_tabs/metadata_table";
import {
  createGroupToSegmentsMap,
  findGroup,
  getGroupByIdWithSubgroups,
} from "viewer/view/right_border_tabs/trees_tab/tree_hierarchy_view_helpers";

export interface SegmentDetailsPanelProps {
  selectedIds: { segments: number[]; group: number | null };
  segments: any | null | undefined; // any = Collection<Segment> or Map<number, Segment>
  segmentGroups: SegmentGroup[];
  visibleSegmentationLayer: APIDataLayer | null | undefined;
  allowUpdate: boolean;
}

export const SegmentDetailsPanel: React.FC<SegmentDetailsPanelProps> = ({
  selectedIds,
  segments,
  segmentGroups,
  visibleSegmentationLayer,
  allowUpdate,
}) => {
  const dispatch = useDispatch();

  const setMetadata = useCallback(
    (segment: Segment, newProperties: MetadataEntryProto[]) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      dispatch(
        updateSegmentAction(
          segment.id,
          { metadata: newProperties },
          visibleSegmentationLayer.name,
          undefined,
          true,
        ),
      );
    },
    [dispatch, visibleSegmentationLayer],
  );

  const renameActiveSegment = useCallback(
    (newName: string) => {
      if (visibleSegmentationLayer == null) {
        return;
      }
      const { segments: activeSegments } = selectedIds;
      if (activeSegments.length !== 1) {
        return;
      }
      const segment = segments?.getNullable(activeSegments[0]);
      if (segment == null) {
        return;
      }

      dispatch(
        updateSegmentAction(
          segment.id,
          { name: newName },
          visibleSegmentationLayer.name,
          undefined,
          true,
        ),
      );
    },
    [dispatch, selectedIds, segments, visibleSegmentationLayer],
  );

  const { segments: selectedSegmentIds, group: selectedGroupId } = selectedIds;

  if (selectedSegmentIds.length === 1) {
    const readOnly = !allowUpdate;
    const segment = segments?.getNullable(selectedSegmentIds[0]);
    if (segment == null) {
      return <>Cannot find details for selected segment.</>;
    }
    return (
      <table className="metadata-table">
        <thead>
          <SimpleRow isTableHead label="ID" value={segment.id} />
        </thead>
        <tbody>
          <SimpleRow
            label="Name"
            value={
              <InputWithUpdateOnBlur value={segment.name || ""} onChange={renameActiveSegment} />
            }
          />
          <MetadataEntryTableRows item={segment} setMetadata={setMetadata} readOnly={readOnly} />
        </tbody>
      </table>
    );
  } else if (selectedGroupId != null) {
    const activeGroup = findGroup(segmentGroups, selectedGroupId);
    if (!activeGroup || segments == null) {
      return null;
    }

    const groupToSegmentsMap = createGroupToSegmentsMap(segments);
    const groupWithSubgroups = getGroupByIdWithSubgroups(segmentGroups, selectedGroupId);

    return (
      <table className="metadata-table">
        <thead>
          <SimpleRow isTableHead label="ID" value={activeGroup.groupId} />
        </thead>
        <tbody>
          <SimpleRow
            label="Name"
            value={
              <InputWithUpdateOnBlur
                value={activeGroup.name || ""}
                onChange={(newName) => {
                  if (visibleSegmentationLayer == null) {
                    return;
                  }
                  api.tracing.renameSegmentGroup(
                    activeGroup.groupId,
                    newName,
                    visibleSegmentationLayer.name,
                  );
                }}
              />
            }
          />

          {groupWithSubgroups.length === 1 ? (
            <SimpleRow
              label="Segment Count"
              value={groupToSegmentsMap[selectedGroupId]?.length ?? 0}
            />
          ) : (
            <>
              <SimpleRow
                label="Segment Count (direct children)"
                value={groupToSegmentsMap[selectedGroupId]?.length ?? 0}
              />
              <SimpleRow
                label="Segment Count (all children)"
                value={sum(
                  groupWithSubgroups.map((groupId) => groupToSegmentsMap[groupId]?.length ?? 0),
                )}
              />
            </>
          )}
        </tbody>
      </table>
    );
  }

  return null;
};
