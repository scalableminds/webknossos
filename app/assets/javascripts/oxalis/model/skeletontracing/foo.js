/**
 * foo.js
 * @flow
 */

import Maybe from "monet";
import Store from "oxalis/store";
import Toast from "libs/toast";

const UPDATE_ERROR = "You cannot update this tracing, because you are in Read-only mode!";
const UPDATE_WARNING = "This change will not be persisted, because your are in Read-only mode!";

function isUpdateAllowed(error = true):boolean {
  if (Store.getState().skeletonTracing.restrictions.allowUpdate) {
    return true;
  } else {
    // Display error or warning if it wasn't displayed before
    if (error) {
      if (!this.issuedUpdateError) {
        Toast.error(UPDATE_ERROR);
        this.issuedUpdateError = true;
      }
    } else if (!this.issuedUpdateWarning) {
      Toast.warning(UPDATE_WARNING);
      this.issuedUpdateWarning = true;
    }
    return false;
  }
}

export function createBranchPoint():Maybe {
  const { branchPointsAllowed, updateAllowed } = Store.getState().skeletonTracing.restrictions;
  const { activeNode } = Store.getState().skeletonTracing;

  if (branchPointsAllowed && updateAllowed && activeNode) {
    return Maybe.Some({
      id: this.activeNode.id,
      timestamp: Date.now(),
    });
  }
  return Maybe.None();
}

export function deleteBranchPoint() {
  const { branchPointsAllowed, updateAllowed } = Store.getState().skeletonTracing.restrictions;
  const { activeNode, trees } = Store.getState().skeletonTracing;

  let curTime = 0;
  let curPoint = null;
  let curTree = null;

  _.maxBy(trees, (tree) => {
    return _.maxBy(tree.branchPoints, (branchPoint) => {
      branch.timestamp;
    })
  });
    for (const tree of this.trees) {
      for (const branch of tree.branchPoints) {
        if (branch.timestamp > curTime) {
          curTime = branch.timestamp;
          curPoint = branch;
          curTree = tree;
        }
      }
    }

    return [curPoint, curTree];

  tree.removeBranchWithNodeId(point.id);
    this.setActiveNode(point.id);

}

export function popBranch() {
  if (!this.restrictionHandler.updateAllowed()) { return Promise.resolve(); }

  const reallyPopBranch = (point, tree, resolve) => {
    // this.stateLogger.updateTree(tree);
    this.setActiveNode(point.id);

    // this.trigger("setBranch", false, this.activeNode);
    this.doubleBranchPop = true;
    const activeNode = this.activeNode;
    if (activeNode) {
      this.centerActiveNode();
      resolve(activeNode.id);
    }
  };

  return new Promise((resolve, reject) => {
    if (this.branchPointsAllowed) {
      const [point, tree] = this.getNextBranch();
      if (point) {
        if (this.doubleBranchPop) {
          Modal.show("You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
            "Jump again?",
            [{ id: "jump-button", label: "Jump again", callback: () => reallyPopBranch(point, tree, resolve) },
             { id: "cancel-button", label: "Cancel" }]);
        } else {
          reallyPopBranch(point, tree, resolve);
        }
      } else {
        Toast.error("No more branchpoints", false);
        reject();
      }
    } else {
      Toast.error("Setting branchpoints isn't necessary in this tracing mode.", false);
      reject();
    }
  },
  );
}
