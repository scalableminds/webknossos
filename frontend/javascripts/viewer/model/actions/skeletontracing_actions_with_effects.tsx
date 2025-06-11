import { Modal } from "antd";
import renderIndependently from "libs/render_independently";
import messages from "messages";
import {
  enforceSkeletonTracing,
  getTree,
  getTreeAndNode,
} from "viewer/model/accessors/skeletontracing_accessor";
import type { WebknossosState } from "viewer/store";
import Store from "viewer/store";
import RemoveTreeModal from "viewer/view/remove_tree_modal";
import {
  deleteNodeAction,
  type DeleteNodeAction,
  deleteTreeAction,
  type DeleteTreeAction,
  noAction,
  type NoAction,
} from "./skeletontracing_actions";

// The following functions are used as a direct response to a user action.
// The functions may interact with the Store which is why they are in a separate file
// (this avoids cyclic dependencies).
// The functions offer some additional logic which is sensible from a user-centered point of view.
// For example, the deleteNodeAsUserAction also initiates the deletion of a tree,
// when the current tree is empty.
// Ideally, this module should be refactored away (instead the logic should live in sagas).
export const deleteNodeAsUserAction = (
  state: WebknossosState,
  nodeId?: number,
  treeId?: number,
): DeleteNodeAction | NoAction | DeleteTreeAction => {
  const skeletonTracing = enforceSkeletonTracing(state.annotation);
  const treeAndNode = getTreeAndNode(skeletonTracing, nodeId, treeId);

  if (!treeAndNode) {
    const tree = getTree(skeletonTracing, treeId);
    if (!tree) return noAction();

    // If the tree is empty, it will be deleted
    return tree.nodes.size() === 0 ? deleteTreeAction(tree.treeId) : noAction();
  }

  const [tree, node] = treeAndNode;

  if (state.task != null && node.id === 1) {
    // Let the user confirm the deletion of the initial node (node with id 1) of a task
    Modal.confirm({
      title: messages["tracing.delete_initial_node"],
      onOk: () => {
        Store.dispatch(deleteNodeAction(node.id, tree.treeId));
      },
    });
    // As Modal.confirm is async, return noAction() and the modal will dispatch the real action
    // if the user confirms
    return noAction();
  }

  return deleteNodeAction(node.id, tree.treeId);
};

// Let the user confirm the deletion of the initial node (node with id 1) of a task
function confirmDeletingInitialNode(treeId: number) {
  Modal.confirm({
    title: messages["tracing.delete_tree_with_initial_node"],
    onOk: () => {
      Store.dispatch(deleteTreeAction(treeId));
    },
  });
}

export const handleDeleteTreeByUser = (treeId?: number) => {
  const state = Store.getState();
  const skeletonTracing = enforceSkeletonTracing(state.annotation);
  const tree = getTree(skeletonTracing, treeId);
  if (!tree) return;

  if (state.task != null && tree.nodes.has(1)) {
    confirmDeletingInitialNode(tree.treeId);
  } else if (state.userConfiguration.hideTreeRemovalWarning) {
    Store.dispatch(deleteTreeAction(tree.treeId));
  } else {
    renderIndependently((destroy) => (
      <RemoveTreeModal
        onOk={() => Store.dispatch(deleteTreeAction(tree.treeId))}
        destroy={destroy}
      />
    ));
  }
};
