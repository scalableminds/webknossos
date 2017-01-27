import app from "app";
import Backbone from "backbone";
import _ from "lodash";
import Utils from "libs/utils";
import ColorGenerator from "libs/color_generator";
import TracePoint from "./tracepoint";
import TraceTree from "./tracetree";
import SkeletonTracingStateLogger from "./skeletontracing_statelogger";
import RestrictionHandler from "../helpers/restriction_handler";
import TracingParser from "./tracingparser";

class SkeletonTracing {
  static initClass() {
    // Max and min radius in base voxels (see scaleInfo.baseVoxel)
    this.prototype.MIN_RADIUS = 1;
    this.prototype.MAX_RADIUS = 5000;

    this.prototype.trees = [];
    this.prototype.activeNode = null;
    this.prototype.activeTree = null;
    this.prototype.firstEdgeDirection = null;
  }

  constructor(tracing, flycam, flycam3d, user) {
    this.flycam = flycam;
    this.flycam3d = flycam3d;
    this.user = user;
    _.extend(this, Backbone.Events);

    this.doubleBranchPop = false;

    this.data = tracing.content.contentData;
    this.restrictionHandler = new RestrictionHandler(tracing.restrictions);


    // ########### Load Tree from @data ##############

    this.stateLogger = new SkeletonTracingStateLogger(
      this.flycam, this.flycam3d, tracing.version, tracing.id, tracing.typ,
      tracing.restrictions.allowUpdate, this);

    const tracingParser = new TracingParser(this, this.data);
    ({
      idCount: this.idCount,
      treeIdCount: this.treeIdCount,
      trees: this.trees,
      activeNode: this.activeNode,
      activeTree: this.activeTree,
    } = tracingParser.parse());

    const tracingType = tracing.typ;

    this.initializeTrees(tracingType, Utils.__guard__(tracing.task, x => x.id));

    if ((tracingType === "Task") && this.getNodeListOfAllTrees().length === 0) {
      this.addNode(tracing.content.editPosition, tracing.content.editRotation, 0, 0, 4, false);
    }

    this.branchPointsAllowed = tracing.content.settings.branchPointsAllowed;
    if (!this.branchPointsAllowed) {
      // calculate direction of first edge in nm
      if (Utils.__guard__(this.data.trees[0], x1 => x1.edges) != null) {
        for (const edge of this.data.trees[0].edges) {
          const sourceNode = this.findNodeInList(this.trees[0].nodes, edge.source).pos;
          const targetNode = this.findNodeInList(this.trees[0].nodes, edge.target).pos;
          if (sourceNode[0] !== targetNode[0] || sourceNode[1] !== targetNode[1] || sourceNode[2] !== targetNode[2]) {
            this.firstEdgeDirection = [targetNode[0] - sourceNode[0],
              targetNode[1] - sourceNode[1],
              targetNode[2] - sourceNode[2]];
            break;
          }
        }
      }

      if (this.firstEdgeDirection) {
        this.flycam.setSpaceDirection(this.firstEdgeDirection);
      }
    }
  }


  initializeTrees(tracingType, taskId) {
    // Initialize tree colors
    this.colorIdCounter = this.treeIdCount;

    // Initialize tree name prefix
    this.TREE_PREFIX = this.generateTreeNamePrefix(tracingType, taskId);

    for (const tree of this.trees) {
      if (tree.color == null) {
        this.shuffleTreeColor(tree);
      }
    }

    // Ensure a tree is active
    if (!this.activeTree) {
      if (this.trees.length > 0) {
        this.activeTree = this.trees[0];
      } else {
        this.createNewTree();
      }
    }
  }


  benchmark(numberOfTrees, numberOfNodesPerTree = 1) {
    if (numberOfNodesPerTree == null) { numberOfNodesPerTree = 10000; }
    console.log(`[benchmark] start inserting ${numberOfNodesPerTree} nodes`);
    const startTime = (new Date()).getTime();
    let offset = 0;
    const size = numberOfNodesPerTree / 10;
    for (let i = 0; i < numberOfTrees; i++) {
      this.createNewTree();
      for (let j = 0; j < numberOfNodesPerTree; j++) {
        const pos = [(Math.random() * size) + offset, (Math.random() * size) + offset, (Math.random() * size) + offset];
        const point = new TracePoint(this.idCount++, pos, Math.random() * 200, this.activeTree.treeId, null, [0, 0, 0]);
        this.activeTree.nodes.push(point);
        if (this.activeNode) {
          this.activeNode.appendNext(point);
          point.appendNext(this.activeNode);
          this.activeNode = point;
        } else {
          this.activeNode = point;
          if (this.branchPointsAllowed) {
            this.pushBranch();
          }
        }
        this.doubleBranchPop = false;
      }
      offset += size;
    }
    this.trigger("reloadTrees");
    console.log(`[benchmark] done. Took me ${((new Date()).getTime() - startTime) / 1000} seconds.`);
  }


  pushBranch() {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (this.branchPointsAllowed) {
      if (this.activeNode) {
        this.activeTree.branchpoints.push({ id: this.activeNode.id, timestamp: Date.now() });
        this.stateLogger.updateTree(this.activeTree);

        this.trigger("setBranch", true, this.activeNode);
      }
    } else {
      this.trigger("noBranchPoints");
    }
  }


  popBranch() {
    if (!this.restrictionHandler.updateAllowed()) { return Promise.resolve(); }

    const reallyPopBranch = (point, tree, resolve) => {
      tree.removeBranchWithNodeId(point.id);
      this.stateLogger.updateTree(tree);
      this.setActiveNode(point.id);

      this.trigger("setBranch", false, this.activeNode);
      this.doubleBranchPop = true;
      return resolve(this.activeNode.id);
    };

    return new Promise((resolve, reject) => {
      if (this.branchPointsAllowed) {
        const [point, tree] = this.getNextBranch();
        if (point) {
          if (this.doubleBranchPop) {
            this.trigger("doubleBranch", () => reallyPopBranch(point, tree, resolve));
          } else {
            reallyPopBranch(point, tree, resolve);
          }
        } else {
          this.trigger("emptyBranchStack");
          reject();
        }
      } else {
        this.trigger("noBranchPoints");
        reject();
      }
    },
    );
  }


  getNextBranch() {
    let curTime = 0;
    let curPoint = null;
    let curTree = null;

    for (const tree of this.trees) {
      for (const branch of tree.branchpoints) {
        if (branch.timestamp > curTime) {
          curTime = branch.timestamp;
          curPoint = branch;
          curTree = tree;
        }
      }
    }

    return [curPoint, curTree];
  }


  addNode(position, rotation, viewport, resolution, bitDepth, interpolation) {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (this.ensureDirection(position)) {
      let radius = 10 * app.scaleInfo.baseVoxel;
      if (this.activeNode) {
        radius = this.activeNode.radius;
      }

      const metaInfo = {
        timestamp: (new Date()).getTime(),
        viewport,
        resolution,
        bitDepth,
        interpolation,
      };

      const point = new TracePoint(this.idCount++, position, radius, this.activeTree.treeId, metaInfo, rotation);
      this.activeTree.nodes.push(point);

      if (this.activeNode) {
        this.activeNode.appendNext(point);
        point.appendNext(this.activeNode);
        this.activeNode = point;
      } else {
        this.activeNode = point;
        // first node should be a branchpoint
        if (this.branchPointsAllowed) {
          this.pushBranch();
        }
      }

      this.doubleBranchPop = false;

      this.stateLogger.createNode(point, this.activeTree.treeId);

      this.trigger("newNode", this.activeNode.id, this.activeTree.treeId);
      this.trigger("newActiveNode", this.activeNode.id);
    } else {
      this.trigger("wrongDirection");
    }
  }


  ensureDirection(position) {
    if (!this.branchPointsAllowed && this.activeTree.nodes.length === 2 &&
        this.firstEdgeDirection && this.activeTree.treeId === this.trees[0].treeId) {
      const sourceNodeNm = app.scaleInfo.voxelToNm(this.activeTree.nodes[1].pos);
      const targetNodeNm = app.scaleInfo.voxelToNm(position);
      const secondEdgeDirection = [targetNodeNm[0] - sourceNodeNm[0],
        targetNodeNm[1] - sourceNodeNm[1],
        targetNodeNm[2] - sourceNodeNm[2]];

      return ((this.firstEdgeDirection[0] * secondEdgeDirection[0]) +
              (this.firstEdgeDirection[1] * secondEdgeDirection[1]) +
              (this.firstEdgeDirection[2] * secondEdgeDirection[2]) > 0);
    } else {
      return true;
    }
  }


  getActiveNode() { return this.activeNode; }


  getActiveNodeId() {
    if (this.activeNode) { return this.activeNode.id; } else { return null; }
  }


  getActiveNodePos() {
    if (this.activeNode) { return this.activeNode.pos; } else { return null; }
  }


  getActiveNodeRadius() {
    if (this.activeNode) { return this.activeNode.radius; } else { return 10 * app.scaleInfo.baseVoxel; }
  }


  getActiveNodeRotation() {
    if (this.activeNode) { return this.activeNode.rotation; } else { return null; }
  }


  getActiveTree() {
    if (this.activeTree) { return this.activeTree; } else { return null; }
  }


  getActiveTreeId() {
    if (this.activeTree) { return this.activeTree.treeId; } else { return null; }
  }


  getActiveTreeName() {
    if (this.activeTree) { return this.activeTree.name; } else { return null; }
  }


  setTreeName(name) {
    if (this.activeTree) {
      if (name) {
        this.activeTree.name = name;
      } else {
        this.activeTree.name = `Tree${(`00${this.activeTree.treeId}`).slice(-3)}`;
      }
      this.stateLogger.updateTree(this.activeTree);

      this.trigger("newTreeName", this.activeTree.treeId);
    }
  }


  getNode(id) {
    for (const tree of this.trees) {
      for (const node of tree.nodes) {
        if (node.id === id) { return node; }
      }
    }
    return null;
  }


  setActiveNode(nodeID, mergeTree = false) {
    const lastActiveNode = this.activeNode;
    const lastActiveTree = this.activeTree;
    for (const tree of this.trees) {
      for (const node of tree.nodes) {
        if (node.id === nodeID) {
          this.activeNode = node;
          this.activeTree = tree;
          break;
        }
      }
    }

    this.stateLogger.push();
    this.trigger("newActiveNode", this.activeNode.id);
    if (lastActiveTree.treeId !== this.activeTree.treeId) {
      this.trigger("newActiveTree", this.activeTree.treeId);
    }

    if (mergeTree) {
      this.mergeTree(lastActiveNode, lastActiveTree);
    }
  }


  setActiveNodeRadius(radius) {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (this.activeNode != null) {
      this.activeNode.radius = Math.min(this.MAX_RADIUS,
                            Math.max(this.MIN_RADIUS, radius));
      this.stateLogger.updateNode(this.activeNode, this.activeNode.treeId);
      this.trigger("newActiveNodeRadius", radius);
    }
  }


  setComment(commentText) {
    this.trigger("setComment", commentText);
  }


  selectNextTree(forward) {
    let i;
    const trees = this.getTreesSorted(this.user.get("sortTreesByName"));
    for (i of Utils.__range__(0, trees.length, false)) {
      if (this.activeTree.treeId === trees[i].treeId) {
        break;
      }
    }

    const diff = (forward ? 1 : -1) + trees.length;
    this.setActiveTree(trees[(i + diff) % trees.length].treeId);
  }


  centerActiveNode() {
    const position = this.getActiveNodePos();
    if (position) {
      this.flycam.setPosition(position);
    }
  }


  setActiveTree(id) {
    for (const tree of this.trees) {
      if (tree.treeId === id) {
        this.activeTree = tree;
        break;
      }
    }
    if (this.activeTree.nodes.length === 0) {
      this.activeNode = null;
    } else {
      this.activeNode = this.activeTree.nodes[0];
      this.trigger("newActiveNode", this.activeNode.id);
    }
    this.stateLogger.push();

    this.trigger("newActiveTree", this.activeTree.treeId);
  }


  getNewTreeColor() {
    return ColorGenerator.distinctColorForId(this.colorIdCounter++);
  }


  shuffleTreeColor(tree) {
    if (!tree) { tree = this.activeTree; }
    tree.color = this.getNewTreeColor();

    // force the tree color change, although it may not be persisted if the user is in read-only mode
    if (this.restrictionHandler.updateAllowed(false)) {
      this.stateLogger.updateTree(tree);
    }

    this.trigger("newTreeColor", tree.treeId);
  }


  shuffleAllTreeColors() {
    for (const tree of this.trees) {
      this.shuffleTreeColor(tree);
    }
  }


  createNewTree() {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    const tree = new TraceTree(
      this.treeIdCount++,
      this.getNewTreeColor(),
      this.TREE_PREFIX + (`00${this.treeIdCount - 1}`).slice(-3),
      (new Date()).getTime());
    this.trees.push(tree);
    this.activeTree = tree;
    this.activeNode = null;

    this.stateLogger.createTree(tree);

    this.trigger("newTree", tree.treeId, tree.color);
  }


  deleteActiveNode() {
    let branchpoints;
    if (!this.restrictionHandler.updateAllowed()) { return Promise.resolve(); }

    const reallyDeleteActiveNode = (resolve) => {
      for (const neighbor of this.activeNode.neighbors) {
        neighbor.removeNeighbor(this.activeNode.id);
      }
      const updateTree = this.activeTree.removeNode(this.activeNode.id);

      if (updateTree) { this.stateLogger.updateTree(this.activeTree); }

      const deletedNode = this.activeNode;
      this.stateLogger.deleteNode(deletedNode, this.activeTree.treeId);

      const { comments } = this.activeTree;
      branchpoints = this.activeTree.branchpoints;

      if (deletedNode.neighbors.length > 1) {
        // Need to split tree
        const newTrees = [];
        const oldActiveTreeId = this.activeTree.treeId;

        for (const i of Utils.__range__(0, this.activeNode.neighbors.length, false)) {
          let node;
          if (i !== 0) {
            // create new tree for all neighbors, except the first
            this.createNewTree();
          }

          this.activeTree.nodes = [];
          this.getNodeListForRoot(this.activeTree.nodes, deletedNode.neighbors[i]);
          // update tree ids
          if (i !== 0) {
            for (node of this.activeTree.nodes) {
              node.treeId = this.activeTree.treeId;
            }
          }
          this.setActiveNode(deletedNode.neighbors[i].id);
          newTrees.push(this.activeTree);

          // update comments and branchpoints
          this.activeTree.comments = this.getCommentsForNodes(comments, this.activeTree.nodes);
          this.activeTree.branchpoints = this.getBranchpointsForNodes(branchpoints, this.activeTree.nodes);

          if (this.activeTree.treeId !== oldActiveTreeId) {
            const nodeIds = [];
            for (node of this.activeTree.nodes) {
              nodeIds.push(node.id);
            }
            this.stateLogger.moveTreeComponent(oldActiveTreeId, this.activeTree.treeId, nodeIds);
          }
        }

        this.trigger("reloadTrees", newTrees);
      } else if (this.activeNode.neighbors.length === 1) {
        // no children, so just remove it.
        this.setActiveNode(deletedNode.neighbors[0].id);
        this.trigger("deleteActiveNode", deletedNode, this.activeTree.treeId);
      } else {
        this.deleteTree(false);
      }
      resolve();
    };

    return new Promise((resolve, reject) => {
      if (this.activeNode) {
        if (this.getBranchpointsForNodes(this.activeTree.branchpoints, this.activeNode).length) {
          this.trigger("deleteBranch", () => reallyDeleteActiveNode(resolve));
        } else {
          reallyDeleteActiveNode(resolve);
        }
      } else {
        reject();
      }
    },
    );
  }


  deleteTree(notify, id, notifyServer) {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (notify) {
      if (confirm("Do you really want to delete the whole tree?")) {
        this.reallyDeleteTree(id, notifyServer);
      }
    } else {
      this.reallyDeleteTree(id, notifyServer);
    }
  }


  reallyDeleteTree(id, notifyServer = true) {
    let index;
    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (!id) {
      id = this.activeTree.treeId;
    }
    const tree = this.getTree(id);

    for (const i of Utils.__range__(0, this.trees.length, true)) {
      if (this.trees[i].treeId === tree.treeId) {
        index = i;
        break;
      }
    }
    this.trees.splice(index, 1);

    if (notifyServer) {
      this.stateLogger.deleteTree(tree);
    }
    this.trigger("deleteTree", index);

    // Because we always want an active tree, check if we need
    // to create one.
    if (this.trees.length === 0) {
      this.createNewTree();
    } else {
      // just set the last tree to be the active one
      this.setActiveTree(this.trees[this.trees.length - 1].treeId);
    }
  }


  mergeTree(lastNode, lastTree) {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (!lastNode) {
      return;
    }

    const activeNodeID = this.activeNode.id;
    if (lastNode.id !== activeNodeID) {
      if (lastTree.treeId !== this.activeTree.treeId) {
        this.activeTree.nodes = this.activeTree.nodes.concat(lastTree.nodes);
        this.activeTree.comments = this.activeTree.comments.concat(lastTree.comments);
        this.activeTree.branchpoints = this.activeTree.branchpoints.concat(lastTree.branchpoints);
        this.activeNode.appendNext(lastNode);
        lastNode.appendNext(this.activeNode);

        // update tree ids
        for (const node of this.activeTree.nodes) {
          node.treeId = this.activeTree.treeId;
        }

        this.stateLogger.mergeTree(lastTree, this.activeTree, lastNode.id, activeNodeID);

        this.trigger("mergeTree", lastTree.treeId, lastNode, this.activeNode);

        this.deleteTree(false, lastTree.treeId, false);

        this.setActiveNode(activeNodeID);
      } else {
        this.trigger("mergeDifferentTrees");
      }
    }
  }


  updateTree(tree) {
    this.stateLogger.updateTree(tree);
  }


  generateTreeNamePrefix(tracingType, taskId) {
    let user = `${app.currentUser.firstName}_${app.currentUser.lastName}`;
    // Replace spaces in user names
    user = user.replace(/ /g, "_");

    if (tracingType === "Explorational") {
      // Get YYYY-MM-DD string
      const creationDate = new Date().toJSON().slice(0, 10);
      return `explorative_${creationDate}_${user}_`;
    } else {
      return `task_${taskId}_${user}_`;
    }
  }


  getTree(id) {
    if (!id) {
      return this.activeTree;
    }
    for (const tree of this.trees) {
      if (tree.treeId === id) {
        return tree;
      }
    }
    return null;
  }


  getTrees() { return this.trees; }


  getTreesSorted() {
    if (this.user.get("sortTreesByName")) {
      return this.getTreesSortedBy("name");
    } else {
      return this.getTreesSortedBy("timestamp");
    }
  }


  getTreesSortedBy(key, isSortedAscending) {
    return (this.trees.slice(0)).sort(Utils.compareBy(key, isSortedAscending));
  }


  getNodeListForRoot(result, root, previous) {
    // returns a list of nodes that are connected to the parent
    //
    // ASSUMPTION:    we are dealing with a tree, circles would
    //                break this algorithm

    result.push(root);
    let next = root.getNext(previous);
    while (next != null) {
      if (_.isArray(next)) {
        for (const neighbor of next) {
          this.getNodeListForRoot(result, neighbor, root);
        }
        return;
      } else {
        result.push(next);
        const newNext = next.getNext(root);
        root = next;
        next = newNext;
      }
    }
  }


  getNodeListOfAllTrees() {
    let result = [];
    for (const tree of this.trees) {
      result = result.concat(tree.nodes);
    }
    return result;
  }


  findNodeInList(list, id) {
    // Helper method used in initialization

    for (const node of list) {
      if (node.id === id) {
        return node;
      }
    }
    return null;
  }


  getCommentsForNodes(comments, nodes) {
    return _.filter(comments, comment => _.find(nodes, { id: comment.node }));
  }


  getBranchpointsForNodes(branchpoints, nodes) {
    return _.filter(branchpoints, branch => _.find(nodes, { id: branch.id }));
  }


  compareNodes(a, b) {
    if (a.node.treeId < b.node.treeId) {
      return -1;
    }
    if (a.node.treeId > b.node.treeId) {
      return 1;
    }
    return a.node.id - b.node.id;
  }
}
SkeletonTracing.initClass();


export default SkeletonTracing;
