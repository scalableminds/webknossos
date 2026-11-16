import { mayEditAnnotationProperties } from "viewer/model/accessors/annotation_accessor";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import {
  setAnnotationDescriptionAction,
  setAnnotationNameAction,
} from "viewer/model/actions/annotation_actions";
import { updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import {
  addTreesAndGroupsAction,
  deleteTreesAction,
} from "viewer/model/actions/skeletontracing_actions";
import { serializeTreesToFlatNml } from "viewer/model/helpers/nml_export_helpers";
import { parseNml } from "viewer/model/helpers/nml_helpers";
import { waitUntilRebaseFinished } from "viewer/model/helpers/rebase_helpers";
import {
  type MutableTreeGroup,
  MutableTreeMap,
  type TreeGroup,
} from "viewer/model/types/tree_types";
import Store from "viewer/store";
import { MISSING_GROUP_ID } from "viewer/view/right_border_tabs/shared/tree_hierarchy_view_helpers";

// Commands of the cross-origin API that only the layer registration page uses (see
// IframeCommands in layer_registration_protocol.ts). They are not part of the public API
// (api_latest.ts), because their behavior is tailored to the page, e.g. exportTreesAsNmlString
// leaves out the tree groups. The commands that only the landmark iframes use are in
// layer_registration_landmark_iframe.ts.

// The tree groups along the given path of group names, starting at the root level. Stops at
// the first group that doesn't exist, so the result can be shorter than the path.
function findExistingTreeGroupPath(groupNames: string[]): TreeGroup[] {
  const path: TreeGroup[] = [];
  let siblings = enforceSkeletonTracing(Store.getState().annotation).treeGroups;
  for (const name of groupNames) {
    const group = siblings.find((treeGroup) => treeGroup.name === name);
    if (group == null) {
      break;
    }
    path.push(group);
    siblings = group.children;
  }
  return path;
}

function assertMayEditAnnotationProperties() {
  if (!mayEditAnnotationProperties(Store.getState())) {
    throw new Error("The name and description of this annotation can't be changed.");
  }
}

// Replaces the trees directly inside the given tree group with the trees of an NML string.
// Subgroups and their trees are kept.
export async function replaceTreesInGroup(nmlString: string, groupId: number) {
  const { treeGroups, trees } = await parseNml(nmlString);
  // Parse before deleting, so that no save can happen between deleting and adding.
  const oldTreeIds = enforceSkeletonTracing(Store.getState().annotation)
    .trees.values()
    .filter((tree) => tree.groupId === groupId)
    .map((tree) => tree.treeId)
    .toArray();
  if (oldTreeIds.length > 0) {
    Store.dispatch(deleteTreesAction(oldTreeIds, true));
  }
  Store.dispatch(addTreesAndGroupsAction(trees, treeGroups, undefined, true, groupId));
}

// Serializes trees to an NML string. If groupId is given, only the trees directly inside that
// group are exported. Unlike the NML download, hidden trees are included and tree groups are
// left out, so importing the result puts all trees at the root level (or into the target group
// of replaceTreesInGroup).
export function exportTreesAsNmlString(filter: { groupId?: number } = {}): Promise<string> {
  const state = Store.getState();
  const trees = enforceSkeletonTracing(state.annotation)
    .trees.values()
    .filter((tree) => filter.groupId == null || tree.groupId === filter.groupId)
    .toArray();
  return serializeTreesToFlatNml(state, trees);
}

export function setAnnotationName(name: string) {
  assertMayEditAnnotationProperties();
  Store.dispatch(setAnnotationNameAction(name));
}

export async function setAnnotationDescription(description: string) {
  assertMayEditAnnotationProperties();
  // An edit made during an active rebase would otherwise be lost.
  await waitUntilRebaseFinished();
  Store.dispatch(setAnnotationDescriptionAction(description));
}

// Returns the id of the tree group at the given path of group names, starting at the root
// level. Groups along the path that don't exist yet are created.
export function ensureTreeGroupPath(groupNames: string[]): number {
  const existingPath = findExistingTreeGroupPath(groupNames);
  if (existingPath.length < groupNames.length) {
    // The group ids are placeholders. addTreesAndGroupsAction assigns new ids.
    const missingGroups = groupNames
      .slice(existingPath.length)
      .reduceRight<MutableTreeGroup[]>(
        (children, name, index) => [{ groupId: index + 1, name, children }],
        [],
      );
    const parentGroupId = existingPath.at(-1)?.groupId ?? MISSING_GROUP_ID;
    Store.dispatch(
      addTreesAndGroupsAction(new MutableTreeMap(), missingGroups, undefined, true, parentGroupId),
    );
  }

  const path = findExistingTreeGroupPath(groupNames);
  const targetGroup = path.at(-1);
  if (targetGroup == null || path.length < groupNames.length) {
    throw new Error(`Could not create the tree group path ${groupNames.join(" > ")}.`);
  }
  return targetGroup.groupId;
}

// Returns the id of the tree group at the given path of group names, starting at the root
// level, or null if a group along the path doesn't exist. Unlike ensureTreeGroupPath, no groups
// are created.
export function findTreeGroupPath(groupNames: string[]): number | null {
  const path = findExistingTreeGroupPath(groupNames);
  return path.length === groupNames.length ? (path.at(-1)?.groupId ?? null) : null;
}

export function setLayerVisibility(layerName: string, isVisible: boolean) {
  Store.dispatch(updateLayerSettingAction(layerName, "isDisabled", !isVisible));
}
