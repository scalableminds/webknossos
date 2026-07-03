import { SimpleRow } from "dashboard/folders/metadata_table";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import sum from "lodash-es/sum";
import { memo, useCallback } from "react";
import { useDispatch } from "react-redux";
import type { MetadataEntryProto } from "types/api_types";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  setTreeMetadataAction,
  setTreeNameAction,
} from "viewer/model/actions/skeletontracing_actions";
import type { Tree } from "viewer/model/types/tree_types";
import { api } from "viewer/singletons";
import { InputWithUpdateOnBlur } from "viewer/view/components/input_with_update_on_blur";
import {
  createGroupToTreesMap,
  findGroup,
  getGroupByIdWithSubgroups,
} from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";
import { MetadataEntryTableRows } from "../metadata_table";

function TreeDetails({ tree }: { tree: Tree }) {
  const dispatch = useDispatch();
  const readOnly = !useWkSelector(mayEditAnnotation);

  const setMetadata = useCallback(
    (updatedTree: Tree, newProperties: MetadataEntryProto[]) => {
      dispatch(setTreeMetadataAction(newProperties, updatedTree.treeId));
    },
    [dispatch],
  );

  return (
    <table className="metadata-table">
      <thead>
        <SimpleRow isTableHead label="ID" value={tree.treeId} />
      </thead>
      <tbody>
        <SimpleRow
          label="Name"
          value={
            <InputWithUpdateOnBlur
              value={tree.name || ""}
              onChange={(newName) => dispatch(setTreeNameAction(newName, tree.treeId))}
            />
          }
        />
        <MetadataEntryTableRows item={tree} setMetadata={setMetadata} readOnly={readOnly} />
      </tbody>
    </table>
  );
}

function GroupDetails({ groupId }: { groupId: number }) {
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const treeGroups = useWkSelector((state) => enforceSkeletonTracing(state.annotation).treeGroups);

  const group = findGroup(treeGroups, groupId);
  if (group == null) {
    return null;
  }

  const groupToTreesMap = createGroupToTreesMap(trees);
  const groupWithSubgroups = getGroupByIdWithSubgroups(treeGroups, groupId);
  const directTreeCount = groupToTreesMap[groupId]?.length ?? 0;

  return (
    <table className="metadata-table">
      <thead>
        <SimpleRow isTableHead label="ID" value={group.groupId} />
      </thead>
      <tbody>
        <SimpleRow
          label="Name"
          value={
            <InputWithUpdateOnBlur
              value={group.name || ""}
              onChange={(newName) => api.tracing.renameSkeletonGroup(groupId, newName)}
            />
          }
        />
        {groupWithSubgroups.length === 1 ? (
          <SimpleRow label="Tree Count" value={directTreeCount} />
        ) : (
          <>
            <SimpleRow label="Tree Count (direct children)" value={directTreeCount} />
            <SimpleRow
              label="Tree Count (all children)"
              value={sum(
                groupWithSubgroups.map((subGroupId) => groupToTreesMap[subGroupId]?.length ?? 0),
              )}
            />
          </>
        )}
      </tbody>
    </table>
  );
}

/*
 * Details (name, metadata, tree counts) for the currently selected trees or
 * the active group, shown below the tree hierarchy.
 */
export const SelectionDetails = memo(({ selectedTreeIds }: { selectedTreeIds: number[] }) => {
  const trees = useWkSelector((state) => enforceSkeletonTracing(state.annotation).trees);
  const activeGroupId = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).activeGroupId,
  );

  if (selectedTreeIds.length === 1) {
    const tree = trees.getNullable(selectedTreeIds[0]);
    if (tree == null) {
      return <>Cannot find details for selected tree.</>;
    }
    return <TreeDetails tree={tree} />;
  }

  if (selectedTreeIds.length > 1) {
    return (
      <div>
        {selectedTreeIds.length} {pluralize("Tree", selectedTreeIds.length)} selected.{" "}
      </div>
    );
  }

  if (activeGroupId != null) {
    return <GroupDetails groupId={activeGroupId} />;
  }

  return null;
});
