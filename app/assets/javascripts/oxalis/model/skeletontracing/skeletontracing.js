/*
* skeletontracing.js
* @flow weak
*/
import app from "app";
import Backbone from "backbone";
import _ from "lodash";
import Utils from "libs/utils";
import ColorGenerator from "libs/color_generator";
import scaleInfo from "oxalis/model/scaleinfo";
import type { Vector3 } from "oxalis/constants";
import Flycam from "oxalis/model/flycam2d";
import Flycam3d from "oxalis/model/flycam3d";
import User from "oxalis/model/user";
import type { SkeletonContentDataType } from "oxalis/model";
import TracePoint from "./tracepoint";
import TraceTree from "./tracetree";
import SkeletonTracingStateLogger from "./skeletontracing_statelogger";
import RestrictionHandler from "../helpers/restriction_handler";
import TracingParser from "./tracingparser";

// Max and min radius in base voxels (see scaleInfo.baseVoxel)
const MIN_RADIUS = 1;
const MAX_RADIUS = 5000;

class SkeletonTracing {

  flycam: Flycam;
  flycam3d: Flycam3d;
  user: User;
  trees: Array<TraceTree>;
  activeNode: ?TracePoint;
  activeTree: TraceTree;
  firstEdgeDirection: Vector3;
  doubleBranchPop: boolean;
  data: SkeletonContentDataType;
  restrictionHandler: RestrictionHandler;
  stateLogger: SkeletonTracingStateLogger;
  trigger: Function;
  treeIdCount: number;
  colorIdCounter: number;
  idCount: number;
  treePrefix: string;
  branchPointsAllowed: boolean;

  constructor(tracing, flycam, flycam3d, user) {
    this.flycam = flycam;
    this.flycam3d = flycam3d;
    this.user = user;
    this.trees = [];

    _.extend(this, Backbone.Events);

    this.doubleBranchPop = false;

    this.data = tracing.content.contentData;
    this.restrictionHandler = new RestrictionHandler(tracing.restrictions);


    // ########### Load Tree from @data ##############

    this.stateLogger = new SkeletonTracingStateLogger(
      this.flycam, this.flycam3d, tracing.version, tracing.id, tracing.typ,
      tracing.restrictions.allowUpdate, this);

    const tracingParser = new TracingParser(this, this.data);
    const parsedTracing = tracingParser.parse();

    this.idCount = parsedTracing.idCount;
    this.treeIdCount = parsedTracing.treeIdCount;
    this.trees = parsedTracing.trees;
    this.activeNode = parsedTracing.activeNode;
    this.activeTree = parsedTracing.activeTree;


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
    this.treePrefix = this.generateTreeNamePrefix(tracingType, taskId);

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


  benchmark(numberOfTrees: number, numberOfNodesPerTree: number = 1) {
    if (numberOfNodesPerTree == null) { numberOfNodesPerTree = 10000; }
    console.log(`[benchmark] start inserting ${numberOfNodesPerTree} nodes`);
    const startTime = (new Date()).getTime();
    let offset = 0;
    const size = numberOfNodesPerTree / 10;
    for (let i = 0; i < numberOfTrees; i++) {
      this.createNewTree();
      for (let j = 0; j < numberOfNodesPerTree; j++) {
        const pos = [(Math.random() * size) + offset, (Math.random() * size) + offset, (Math.random() * size) + offset];
        const point = new TracePoint(this.idCount++, pos, Math.random() * 200, this.activeTree.treeId, [0, 0, 0], Date.now());
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
        const newPoint = {
          id: this.activeNode.id,
          timestamp: Date.now(),
        };
        this.activeTree.branchPoints.push(newPoint);
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
      const activeNode = this.activeNode;
      if (activeNode) {
        resolve(activeNode.id);
      }
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
      for (const branch of tree.branchPoints) {
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
      let radius = 10 * scaleInfo.baseVoxel;
      if (this.activeNode) {
        radius = this.activeNode.radius;
      }

      const point = new TracePoint(this.idCount++, position, radius, this.activeTree.treeId, rotation, Date.now(), viewport, resolution, bitDepth, interpolation);
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

      const activeNode = this.activeNode;
      if (activeNode) {
        this.trigger("newNode", activeNode.id, this.activeTree.treeId);
        this.trigger("newActiveNode", activeNode.id);
      }
    } else {
      this.trigger("wrongDirection");
    }
  }


  ensureDirection(position) {
    if (!this.branchPointsAllowed && this.activeTree.nodes.length === 2 &&
        this.firstEdgeDirection && this.activeTree.treeId === this.trees[0].treeId) {
      const sourceNodeNm = scaleInfo.voxelToNm(this.activeTree.nodes[1].position);
      const targetNodeNm = scaleInfo.voxelToNm(position);
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
    if (this.activeNode) { return this.activeNode.position; } else { return null; }
  }


  getActiveNodeRadius() {
    if (this.activeNode) { return this.activeNode.radius; } else { return 10 * scaleInfo.baseVoxel; }
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
    const activeNode = this.activeNode;
    if (activeNode) {
      this.trigger("newActiveNode", activeNode.id);
      if (lastActiveTree.treeId !== this.activeTree.treeId) {
        this.trigger("newActiveTree", this.activeTree.treeId);
      }

      if (mergeTree) {
        this.mergeTree(lastActiveNode, lastActiveTree);
      }
    }
  }


  setActiveNodeRadius(radius) {
    if (!this.restrictionHandler.updateAllowed()) { return; }

    const activeNode = this.activeNode;
    if (activeNode != null) {
      activeNode.radius = Math.min(MAX_RADIUS,
                            Math.max(MIN_RADIUS, radius));
      this.stateLogger.updateNode(activeNode);
      this.trigger("newActiveNodeRadius", radius);
    }
  }


  setCommentForNode(commentText: string, node: TracePoint) {
    // add, delete or update a comment
    const nodeId = node.id;
    const tree = this.getTree(node.treeId);

    let comment = this.getCommentForNode(nodeId, tree);
    if (comment) {
      if (commentText !== "") {
        comment.content = commentText;
      } else {
        tree.removeCommentWithNodeId(nodeId);
      }
    } else if (commentText !== "") {
      comment = {
        node: nodeId,
        content: commentText,
      };
      tree.comments.push(comment);
    }

    this.stateLogger.updateTree(tree);
    this.trigger("newComment");
  }


  getCommentForNode(nodeId: number, tree: ?TraceTree) {
    let trees;
    if (tree == null) {
      trees = this.getTrees();
    } else {
      trees = [tree];
    }

    for (const curTree of trees) {
      const found = _.find(curTree.comments, { node: nodeId });
      if (found) { return found; }
    }
    return null;
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
      this.treePrefix + (`00${this.treeIdCount - 1}`).slice(-3),
      Date.now(),
    );
    this.trees.push(tree);
    this.activeTree = tree;
    this.activeNode = null;

    this.stateLogger.createTree(tree);

    this.trigger("newTree", tree.treeId, tree.color);
  }


  deleteActiveNode() {
    let branchPoints;
    if (!this.restrictionHandler.updateAllowed()) { return Promise.resolve(); }

    const reallyDeleteActiveNode = (resolve) => {
      const activeNode = this.activeNode;
      if (activeNode) {
        for (const neighbor of activeNode.neighbors) {
          neighbor.removeNeighbor(activeNode.id);
        }
        const updateTree = this.activeTree.removeNode(activeNode.id);

        if (updateTree) { this.stateLogger.updateTree(this.activeTree); }

        const deletedNode = activeNode;
        this.stateLogger.deleteNode(deletedNode, this.activeTree.treeId);

        const { comments } = this.activeTree;
        branchPoints = this.activeTree.branchPoints;

        if (deletedNode.neighbors.length > 1) {
          // Need to split tree
          const newTrees = [];
          const oldActiveTreeId = this.activeTree.treeId;

          for (let i = 0; i < activeNode.neighbors.length; i++) {
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

            // update comments and branchPoints
            this.activeTree.comments = this.getCommentsForNodes(comments, this.activeTree.nodes);
            this.activeTree.branchPoints = this.getbranchPointsForNodes(branchPoints, this.activeTree.nodes);

            if (this.activeTree.treeId !== oldActiveTreeId) {
              const nodeIds = [];
              for (node of this.activeTree.nodes) {
                nodeIds.push(node.id);
              }
              this.stateLogger.moveTreeComponent(oldActiveTreeId, this.activeTree.treeId, nodeIds);
            }
          }
          this.trigger("reloadTrees", newTrees);
        } else if (activeNode.neighbors.length === 1) {
          // no children, so just remove it.
          this.setActiveNode(deletedNode.neighbors[0].id);
          this.trigger("deleteActiveNode", deletedNode, this.activeTree.treeId);
        } else {
          this.deleteTree(false);
        }
        resolve();
      }
    };

    return new Promise((resolve, reject) => {
      const activeNode = this.activeNode;
      if (activeNode) {
        if (this.getbranchPointsForNodes(this.activeTree.branchPoints, [activeNode]).length) {
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
    if (!this.restrictionHandler.updateAllowed()) { return; }

    if (!id) {
      id = this.activeTree.treeId;
    }
    const tree = this.getTree(id);

    const index = _.findIndex(this.trees, t => t.treeId === tree.treeId);
    this.trees.splice(index, 1);

    if (notifyServer) {
      this.stateLogger.deleteTree(tree);
    }
    this.trigger("deleteTree", id);

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
    const activeNode = this.activeNode;
    if (activeNode && lastNode.id !== activeNode.id) {
      const activeNodeID = activeNode.id;
      if (lastTree.treeId !== this.activeTree.treeId) {
        this.activeTree.nodes = this.activeTree.nodes.concat(lastTree.nodes);
        this.activeTree.comments = this.activeTree.comments.concat(lastTree.comments);
        this.activeTree.branchPoints = this.activeTree.branchPoints.concat(lastTree.branchPoints);
        activeNode.appendNext(lastNode);
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


  getbranchPointsForNodes(branchPoints, nodes) {
    return _.filter(branchPoints, branch => _.find(nodes, { id: branch.id }));
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


export default SkeletonTracing;
