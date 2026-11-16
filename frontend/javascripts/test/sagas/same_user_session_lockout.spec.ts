import update from "immutability-helper";
import { initialSkeletonTracing } from "test/fixtures/hybridtracing_object";
import type { APIUpdateActionBatch } from "types/api_types";
import { containsOwnTreeEditFromOtherSession } from "viewer/model/sagas/saving/rebasing/same_user_session_lockout";
import type { TreeMap } from "viewer/model/types/tree_types";
import { describe, expect, it } from "vitest";

// Tree 1 is a default tree, tree 2 is an agglomerate tree.
const skeletonTracing = initialSkeletonTracing;

function batchWith(action: object): APIUpdateActionBatch[] {
  return [{ version: 2, value: [action] } as unknown as APIUpdateActionBatch];
}

function createNodeAction(treeId: number, authorId: string) {
  return {
    name: "createNode",
    value: {
      treeId,
      id: 10,
      actionTracingId: "skeleton",
      actionTimestamp: 0,
      actionAuthorId: authorId,
    },
  };
}

describe("containsOwnTreeEditFromOtherSession", () => {
  it("should detect a tree edit by the current user from another session", () => {
    expect(
      containsOwnTreeEditFromOtherSession(
        batchWith(createNodeAction(1, "me")),
        "me",
        skeletonTracing,
      ),
    ).toBe(true);
  });

  it("should ignore tree edits by other users", () => {
    expect(
      containsOwnTreeEditFromOtherSession(
        batchWith(createNodeAction(1, "other")),
        "me",
        skeletonTracing,
      ),
    ).toBe(false);
  });

  it("should ignore edits of agglomerate trees", () => {
    expect(
      containsOwnTreeEditFromOtherSession(
        batchWith(createNodeAction(2, "me")),
        "me",
        skeletonTracing,
      ),
    ).toBe(false);
  });

  it("should ignore agglomerate trees that were created by the fetched actions", () => {
    const createAgglomerateTree = {
      name: "createTree",
      value: { id: 50, type: "AGGLOMERATE", actionAuthorId: "me", actionTimestamp: 0 },
    };
    const batches = [
      {
        version: 2,
        value: [createAgglomerateTree, createNodeAction(50, "me")],
      } as unknown as APIUpdateActionBatch,
    ];
    expect(containsOwnTreeEditFromOtherSession(batches, "me", skeletonTracing)).toBe(false);
  });

  it("should ignore user-specific state like tree visibility", () => {
    const visibilityAction = {
      name: "updateTreeVisibility",
      value: { treeId: 1, isVisible: false, actionAuthorId: "me", actionTimestamp: 0 },
    };
    expect(
      containsOwnTreeEditFromOtherSession(batchWith(visibilityAction), "me", skeletonTracing),
    ).toBe(false);
  });

  it("should detect a merge into a default tree", () => {
    const skeletonWithTwoDefaultTrees = update(skeletonTracing, {
      trees: {
        $apply: (trees: TreeMap) => trees.set(3, { ...trees.getOrThrow(1), treeId: 3 }),
      },
    });
    const moveAction = {
      name: "moveTreeComponent",
      value: { sourceId: 2, targetId: 3, nodeIds: [], actionAuthorId: "me", actionTimestamp: 0 },
    };
    expect(
      containsOwnTreeEditFromOtherSession(batchWith(moveAction), "me", skeletonWithTwoDefaultTrees),
    ).toBe(true);
  });
});
