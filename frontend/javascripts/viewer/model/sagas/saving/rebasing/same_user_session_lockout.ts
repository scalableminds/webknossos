import type { APIUpdateActionBatch } from "types/api_types";
import { TreeTypeEnum } from "viewer/constants";
import type { ServerUpdateAction } from "viewer/model/sagas/volume/update_actions";
import type { SkeletonTracing } from "viewer/store";

/*
 * In live collaboration, only the owner of a (non-agglomerate) tree may edit it. The same user
 * can still edit their trees from several sessions (tabs or windows). A session never fetches
 * its own saved updates again, so a fetched tree edit authored by the current user must come from
 * another session of that user. Such a session is locked out instead of merging the edits.
 * See design/collaborative_skeleton_annotation.md.
 */

// Returns the ids of the trees that the given action edits, or null if the action does not edit
// trees. User-specific state (visibility, active node, expanded groups) is not considered as an
// edit. updateTreeGroups is not considered either, because editing the tree group hierarchy is
// not possible in live collaboration (proofreading may still emit it for agglomerate trees).
function getEditedTreeIds(action: ServerUpdateAction): number[] | null {
  switch (action.name) {
    case "createTree":
    case "updateTree":
    case "deleteTree":
      return [action.value.id];
    case "moveTreeComponent":
    case "mergeTree":
      return [action.value.sourceId, action.value.targetId];
    case "createNode":
    case "updateNode":
    case "deleteNode":
    case "createEdge":
    case "deleteEdge":
    case "updateTreeEdgesVisibility":
      return [action.value.treeId];
    default:
      return null;
  }
}

export function containsOwnTreeEditFromOtherSession(
  batches: APIUpdateActionBatch[],
  activeUserId: string | null | undefined,
  skeletonTracing: SkeletonTracing | null | undefined,
): boolean {
  if (activeUserId == null) {
    return false;
  }
  // Trees created by the fetched actions don't exist locally yet. Their type is only known
  // from the createTree action.
  const agglomerateTreeIdsCreatedRemotely = new Set<number>();
  for (const batch of batches) {
    for (const action of batch.value) {
      if (action.name === "createTree" && action.value.type === TreeTypeEnum.AGGLOMERATE) {
        agglomerateTreeIdsCreatedRemotely.add(action.value.id);
      }
    }
  }
  const isAgglomerateTreeId = (treeId: number) =>
    agglomerateTreeIdsCreatedRemotely.has(treeId) ||
    skeletonTracing?.trees.getNullable(treeId)?.type === TreeTypeEnum.AGGLOMERATE;

  for (const batch of batches) {
    for (const action of batch.value) {
      if (action.value.actionAuthorId !== activeUserId) {
        continue;
      }
      const treeIds = getEditedTreeIds(action);
      if (treeIds != null && !treeIds.every(isAgglomerateTreeId)) {
        return true;
      }
    }
  }
  return false;
}
