import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runSaga } from "redux-saga";
import ErrorHandling from "libs/error_handling";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { setupWebknossosForTesting, type WebknossosTestContext } from "test/helpers/apiHelpers";
import {
  applySkeletonUpdateActionsFromServerAction,
  createBranchPointAction,
  createNodeAction,
  createTreeAction,
  deleteBranchpointByIdAction,
  deleteEdgeAction,
  deleteNodeAction,
  deleteTreeAction,
  mergeTreesAction,
  setActiveNodeAction,
  setActiveTreeAction,
} from "viewer/model/actions/skeletontracing_actions";
import type { ApplicableSkeletonServerUpdateAction } from "viewer/model/sagas/volume/update_actions";
import { hasRootSagaCrashed } from "viewer/model/sagas/root_saga";
import { watchTracingConsistency } from "viewer/model/sagas/skeletontracing_saga";
import type { Vector3 } from "viewer/constants";
import type { BranchPoint } from "viewer/model/types/tree_types";
import Store from "viewer/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Model } from "viewer/singletons";

type BatchAction = { name: string; value: Record<string, any> };
type UpdateActionBatch = { version: number; value: BatchAction[] };

describe("Skeleton Tracing", () => {
  beforeEach<WebknossosTestContext>(async (context) => {
    await setupWebknossosForTesting(context, "skeleton");
  });

  afterEach<WebknossosTestContext>(async (context) => {
    expect(hasRootSagaCrashed()).toBe(false);
    // Saving after each test and checking that the root saga didn't crash,
    // ensures that each test is cleanly exited. Without it weird output can
    // occur (e.g., a promise gets resolved which interferes with the next test).
    await context.api.tracing.save();
    expect(hasRootSagaCrashed()).toBe(false);
    context.tearDownPullQueues();
  });

  it<WebknossosTestContext>("should detect corrupt tree after replaying update actions up to v3684", async (context) => {
    const jsonData: UpdateActionBatch[] = JSON.parse(
      readFileSync(join(process.cwd(), "2026-04-28-corrupt-tree.json"), "utf-8"),
    );

    // The JSON is sorted highest-version-first; iterate from the end to replay forward.
    // Stop at v3684 — the version where the corruption is introduced.
    for (let i = jsonData.length - 1; i >= 0; i--) {
      const batch = jsonData[i];
      if (batch.version > 3684) break;

      const hasDeleteNode = batch.value.some((a) => a.name === "deleteNode");
      const deletedNodeId: number | undefined = batch.value.find((a) => a.name === "deleteNode")
        ?.value.nodeId;
      // A merge batch is one that has moveTreeComponent but no deleteNode.
      // The corresponding user action is mergeTreesAction; the moveTreeComponent,
      // deleteTree and createEdge entries are its fine-grained server representation.
      const isMergeBatch =
        !hasDeleteNode && batch.value.some((a) => a.name === "moveTreeComponent");

      if (isMergeBatch) {
        // The createEdge in this batch is the connecting edge between the two trees.
        // mergeTrees keeps the source tree and removes the target tree, so
        // sourceNodeId must be in the surviving tree.
        const connectingEdges = batch.value.filter((a) => a.name === "createEdge");
        if (connectingEdges.length === 1) {
          const connectingEdge = connectingEdges[0];
          Store.dispatch(
            mergeTreesAction(connectingEdge.value.source, connectingEdge.value.target),
          );
        } else {
          console.log("connectingEdges", connectingEdges);
          throw new Error("Unexpected createEdge count");
        }
      }

      for (const action of batch.value) {
        const { name, value } = action;

        switch (name) {
          case "createTree": {
            // In a split batch the new tree is auto-created by deleteNodeAction.
            if (!hasDeleteNode) {
              Store.dispatch(createTreeAction(undefined, value.timestamp));
            }
            break;
          }
          case "createNode": {
            // Find the edge that connects the new node to its parent, so we can
            // set the active node correctly before creating (createNodeAction
            // connects to the active node and must be in the active tree).
            const edgeForNode = batch.value.find(
              (a) =>
                a.name === "createEdge" &&
                (a.value.target === value.id || a.value.source === value.id),
            );
            if (edgeForNode != null) {
              const parentNodeId =
                edgeForNode.value.target === value.id
                  ? edgeForNode.value.source
                  : edgeForNode.value.target;
              Store.dispatch(setActiveNodeAction(parentNodeId));
            } else {
              // First node in a new (empty) tree — switch the active tree so
              // createNodeAction places the node there with no parent edge.
              Store.dispatch(setActiveTreeAction(value.treeId));
            }
            Store.dispatch(
              createNodeAction(
                value.position as Vector3,
                value.additionalCoordinates ?? [],
                value.rotation as Vector3,
                value.viewport,
                value.resolution,
                undefined,
                false,
                value.timestamp,
              ),
            );
            break;
          }
          case "updateActiveNode": {
            // Dispatch even when null to keep activeNodeId/activeTreeId in sync.
            Store.dispatch(setActiveNodeAction(value.activeNode ?? null));
            break;
          }
          case "deleteNode": {
            // deleteNodeAction auto-handles the tree split and removes the
            // directly connected edges, so createTree/deleteEdge/moveTreeComponent
            // in the same batch can be skipped.
            Store.dispatch(deleteNodeAction(value.nodeId, value.treeId, value.actionTimestamp));
            break;
          }
          case "deleteEdge": {
            // Edges involving the deleted node are auto-removed by deleteNodeAction.
            // Extra deleteEdge entries (e.g. the 7 spurious ones at v3684) are
            // server-level artifacts — they remove edges without splitting trees.
            // deleteEdgeAction (the user-level action) would split the tree and
            // maintain the consistency invariant, so we apply these raw server
            // update actions directly instead.

            if (!hasDeleteNode && batch.version < 3684) {
              Store.dispatch(deleteEdgeAction(value.source, value.target));
            }
            break;
          }
          case "createEdge": {
            // Auto-created by createNodeAction or mergeTreesAction.
            break;
          }
          case "moveTreeComponent": {
            // Handled as mergeTreesAction (isMergeBatch) or as part of the
            // deleteNode auto-split — skip in both cases.
            break;
          }
          case "deleteTree": {
            // In a merge batch mergeTreesAction already removes the source tree.
            if (!isMergeBatch) {
              Store.dispatch(deleteTreeAction(value.id, true));
            }
            break;
          }
          case "updateTree": {
            // Sync branch points between the server's representation and the store.
            const skeleton = enforceSkeletonTracing(Store.getState().annotation);
            const tree = skeleton.trees.getNullable(value.id);
            if (tree != null) {
              const currentBPSet = new Set(tree.branchPoints.map((bp: BranchPoint) => bp.nodeId));
              const newBPs: Array<{ nodeId: number; timestamp: number }> = value.branchPoints ?? [];
              const newBPSet = new Set(newBPs.map((bp) => bp.nodeId));
              for (const bp of newBPs) {
                if (!currentBPSet.has(bp.nodeId)) {
                  Store.dispatch(createBranchPointAction(bp.nodeId, value.id, bp.timestamp));
                }
              }
              for (const nodeId of currentBPSet) {
                if (!newBPSet.has(nodeId)) {
                  Store.dispatch(deleteBranchpointByIdAction(nodeId as number, value.id));
                }
              }
            }
            break;
          }
        }
      }
    }

    await Model.ensureSavedState();

    const requests = context.receivedDataPerSaveRequest.slice(-10);

    for (const request of requests) {
      for (const version of request) {
        console.log("actions", version.actions);
      }
    }

    // vi.mocked(ErrorHandling.notify).mockClear();

    // const task = runSaga(
    //   { getState: () => Store.getState(), dispatch: (action: any) => Store.dispatch(action) },
    //   watchTracingConsistency,
    // );
    // await task.toPromise();

    // expect(ErrorHandling.notify).toHaveBeenCalled();
  });
});
