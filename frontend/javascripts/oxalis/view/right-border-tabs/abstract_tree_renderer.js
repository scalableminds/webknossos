/**
 * abstract_tree_renderer.js
 * @flow
 */

import BackboneEvents from "backbone-events-standalone";
import _ from "lodash";

import type { Tree } from "oxalis/store";
import type { Vector2 } from "oxalis/constants";
import messages from "messages";

const NODE_RADIUS = 2;
const MAX_NODE_DISTANCE = 100;
const CLICK_TRESHOLD = 6;
const MODE_NORMAL = 0; // draw every node and the complete tree
const MODE_NOCHAIN = 1; // draw only decision points
const VG_COLOR = "black";
const COMMENT_COLOR = "red";

type Decision = {
  node: Object,
  chainCount: number,
  isBranch: boolean,
  isLeaf: boolean,
  hasActiveNode: boolean,
};

type AbstractTreeMode = typeof MODE_NORMAL | typeof MODE_NOCHAIN;
type AbstractNode = {
  id: number,
  children: Array<AbstractNode>,
};

export type NodeListItem = {
  x: number,
  y: number,
  id: number,
};

const CYCLIC_TREE_ERROR = "CyclicTree";

class AbstractTreeRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  nodeList: Array<NodeListItem>;
  activeNodeId: number;
  tree: Tree;
  nodeDistance: number;

  static drawTree(
    canvas: HTMLCanvasElement,
    tree: ?Tree,
    activeNodeId: ?number,
    size?: Vector2 = [450, 600],
  ) {
    const renderer = new AbstractTreeRenderer(canvas);
    if (tree != null && activeNodeId != null) {
      renderer.setDimensions(size[0], size[1]);
      renderer.clearBackground();
      renderer.drawTree(tree, activeNodeId);
    } else {
      renderer.clearBackground();
    }
    return renderer.nodeList;
  }

  static getIdFromPos(x: number, y: number, nodeList: Array<NodeListItem>): ?number {
    let id = null;
    for (const entry of nodeList) {
      if (Math.abs(x - entry.x) <= CLICK_TRESHOLD && Math.abs(y - entry.y) <= CLICK_TRESHOLD) {
        id = entry.id;
        break;
      }
    }
    return id;
  }

  constructor(canvas: HTMLCanvasElement) {
    _.extend(this, BackboneEvents);

    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (ctx != null) {
      this.ctx = ctx;
      ctx.lineWidth = 1;
    }
    this.nodeList = [];
  }

  buildTree(): ?AbstractNode {
    // Asumption: Node with smallest id is root
    const rootId = _.min(Array.from(this.tree.nodes.keys()));

    const rootNode = { id: rootId, children: [] };
    const queue = [rootNode];
    const visitedNodes = {};

    // Build a tree like structure using Breadth-First-Search
    while (queue.length) {
      const { id: curNodeId, children: curChildren } = queue.shift();

      if (visitedNodes[curNodeId]) {
        throw new Error(CYCLIC_TREE_ERROR);
      } else {
        visitedNodes[curNodeId] = true;
      }

      const edges = this.tree.edges.getOutgoingEdgesForNode(curNodeId);
      const childrenIds = edges.map(edge => edge.target);
      for (const childId of childrenIds) {
        const child = {
          id: childId,
          children: [],
        };
        queue.push(child);
        curChildren.push(child);
      }
    }

    return rootNode;
  }

  /**
   * Render function called by events and GUI.
   * Draws the abstract tree, emphasizes the active node
   * and highlights comments, if enabled.
   * @param  {TreeType} tree
   * @param  {Number} @activeNodeId node id
   */
  drawTree(tree: Tree, activeNodeId: number) {
    let root;
    this.tree = tree;
    this.activeNodeId = activeNodeId;

    // List of {x : ..., y : ..., id: ...} objects
    this.nodeList = [];

    // set global mode
    const mode = MODE_NOCHAIN;

    // TODO: This might not need to be done on every single draw...
    try {
      root = this.buildTree();
    } catch (e) {
      console.log("Error:", e);
      if (e.message === CYCLIC_TREE_ERROR) {
        this.drawErrorMessage(messages["tracing.tree_viewer_no_cyclic_trees"]);
        return;
      }
    }

    if (root == null) {
      return;
    }

    this.nodeDistance = Math.min(
      this.canvas.height / (this.getMaxTreeDepth(root, mode) + 1),
      MAX_NODE_DISTANCE,
    );

    // The algorithm works as follows:
    // A tree is given a left and right border that it can use. If
    // there is a branchpoint, both children are rest trees, so the
    // branch point will choose a left and right border for each of
    // them and call the method recursively.
    // For that decision, the branch points needs information about
    // the rest tree's width. A trees width, however, depends on its
    // children's width. So, we need to do two iterations: first we
    // determine the widths of each relevant node, then we use this
    // information to actually draw the tree. The first task is done
    // by recordWidths(), the second by drawTreeWithWidths().

    this.recordWidths(root);
    this.drawTreeWithWidths(
      root,
      NODE_RADIUS,
      this.canvas.width - NODE_RADIUS,
      this.nodeDistance / 2,
      mode,
    );

    // because of z layering all nodes have to be drawn last
    this.drawAllNodes();
  }

  /**
   * Draws a whole tree inside the given borders.
   * Thus it fits on the canvas and scales as the tree grows.
   * @param  {AbstractNodeType} tree
   * @param  {Number} left  left border in pixels
   * @param  {Number} right right border in pixels
   * @param  {Number} top   y coordinate in pixels
   * @param  {Number} mode  MODE_NORMAL or MODE_NOCHAIN
   * @return {Object}       new middle and top coordinates in pixels
   */
  drawTreeWithWidths(
    tree: AbstractNode,
    left: number,
    right: number,
    top: number,
    mode: AbstractTreeMode,
  ) {
    const decision = this.getNextDecision(tree);
    let middle = this.calculateMiddle(left, right);

    if (decision.isBranch) {
      middle = this.drawBranch(decision, left, right, top, mode);
    } else if (!decision.isLeaf) {
      middle = this.drawCommentChain(decision, left, right, top, mode);
    }

    if (mode === MODE_NORMAL || decision.chainCount < 3) {
      this.drawChainFromTo(top, middle, tree, decision);
    } else if (mode === MODE_NOCHAIN) {
      this.drawChainWithChainIndicatorFromTo(top, middle, tree, decision);
    }

    return { middle, top };
  }

  /**
   * Find the next node which have to be considered in an extra way.
   * These are:
   *   - branch points
   *   - leaves
   *   - commented nodes
   * @param  {AbstractNodeType} tree
   * @return {Decision}
   */
  getNextDecision(tree: AbstractNode): Decision {
    let chainCount = 0;
    let hasActiveNode = false;

    // skip comment check on first node
    if (tree.children.length === 1) {
      tree = tree.children[0];
      chainCount++;
    }

    while (tree.children.length === 1 && !this.nodeIdHasComment(tree.id)) {
      if (!hasActiveNode) {
        hasActiveNode = tree.id === this.activeNodeId;
      }
      tree = tree.children[0];
      chainCount++;
    }

    return {
      node: tree,
      chainCount,
      isBranch: tree.children.length > 1,
      isLeaf: tree.children.length === 0,
      hasActiveNode,
    };
  }

  /**
   * Draw a branch point as well as the left and right subtree.
   * @param  {Decision} decision
   * @param  {Number} left     left border in pixels
   * @param  {Number} right    right border in pixels
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} mode     MODE_NORMAL or MODE_NOCHAIN
   * @return {Number}          new middle coordinate in pixels
   */
  drawBranch(
    decision: Decision,
    left: number,
    right: number,
    top: number,
    mode: AbstractTreeMode,
  ): number {
    const branchMiddle = this.calculateBranchMiddle(decision, left, right);
    const topChildren = this.calculateChildTop(decision.chainCount, top, mode);
    const leftTree = this.drawTreeWithWidths(
      decision.node.children[0],
      left,
      branchMiddle,
      topChildren,
      mode,
    );
    const rightTree = this.drawTreeWithWidths(
      decision.node.children[1],
      branchMiddle,
      right,
      topChildren,
      mode,
    );

    // set the root's x coordinate to be in between the decisionPoint's children
    const middle = this.calculateMiddle(leftTree.middle, rightTree.middle);

    // draw edges from last node in 'chain' (or root, if chain empty)
    // and the decisionPoint's children
    this.drawEdge(middle, topChildren - this.nodeDistance, leftTree.middle, leftTree.top);
    this.drawEdge(middle, topChildren - this.nodeDistance, rightTree.middle, rightTree.top);

    return middle;
  }

  /**
   * Draw a sequence of nodes which begins with a comment.
   * @param  {Decision}        decision
   * @param  {Number} left     left border in pixels
   * @param  {Number} right    right border in pixels
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} mode     MODE_NORMAL or MODE_NOCHAIN
   * @return {Number}          new middle coordinate in pixels
   */
  drawCommentChain(
    decision: Decision,
    left: number,
    right: number,
    top: number,
    mode: AbstractTreeMode,
  ): number {
    const topChild = this.calculateTop(decision.chainCount, top, mode);
    const extent = this.drawTreeWithWidths(decision.node, left, right, topChild, mode);
    return extent.middle;
  }

  /**
   * Draws a sequence of nodes and the edges in between.
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} left     x coordinate in pixels
   * @param  {AbstractNodeType} tree
   * @param  {Decision} decision
   */
  drawChainFromTo(top: number, left: number, tree: AbstractNode, decision: Decision): void {
    // Draw the chain and the tree, connect them.
    let node = tree;
    for (let i = 0; i <= decision.chainCount; i++) {
      this.addNode(left, top + i * this.nodeDistance, node.id);
      node = node.children[0];
      if (i !== 0) {
        this.drawEdge(left, top + (i - 1) * this.nodeDistance, left, top + i * this.nodeDistance);
      }
    }
  }

  /**
   * Draws the dashed chain indicator and the start and end nodes.
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} middle   middel x coordinate in pixels
   * @param  {AbstractNodeType} node
   * @param  {Decision} decision
   */
  drawChainWithChainIndicatorFromTo(
    top: number,
    middle: number,
    node: AbstractNode,
    decision: Decision,
  ): void {
    this.addNode(middle, top, node.id);
    this.drawEdge(middle, top, middle, top + 0.5 * this.nodeDistance);
    this.drawChainIndicator(
      middle,
      top + 0.5 * this.nodeDistance,
      top + 1.5 * this.nodeDistance,
      decision.hasActiveNode,
    );
    this.drawEdge(middle, top + 1.5 * this.nodeDistance, middle, top + 2 * this.nodeDistance);
    this.addNode(middle, top + 2 * this.nodeDistance, decision.node.id);
  }

  /**
   * Calculate middle that divides the left and right tree, if any.
   * Middle is weighted accordingly to the subtrees` widths.
   * @param  {Decision} decision
   * @param  {Number} left           left border in pixels
   * @param  {Number} right          right border in pixels
   * @return {Number}                middle in pixels
   */
  calculateBranchMiddle(decision: Decision, left: number, right: number): number {
    const leftChild = decision.node.children[0];
    const rightChild = decision.node.children[1];
    return ((right - left) * leftChild.width) / (leftChild.width + rightChild.width) + left;
  }

  /**
   * Calculate middle of a left and right border.
   * @param  {Number} left  left border in pixels
   * @param  {Number} right right border in pixels
   * @return {Number}       middle in pixels
   */
  calculateMiddle(left: number, right: number): number {
    return (left + right) / 2;
  }

  /**
   * Calculate the y coordinate of a node.
   * @param  {Number} chainCount amount of chained nodes since the parent node
   * @param  {Number} top        y coordinate of the parent node
   * @param  {Number} mode       MODE_NORMAL or MODE_NOCHAIN
   * @return {Number}            y coordinate of the current decision node
   */
  calculateTop(chainCount: number, top: number, mode: AbstractTreeMode): number {
    if (mode === MODE_NORMAL || chainCount < 3) {
      return top + chainCount * this.nodeDistance;
    } else if (mode === MODE_NOCHAIN) {
      return top + 2 * this.nodeDistance;
    }
    return 0;
  }

  /**
   * Calculate the y coordinate of the first child of a node.
   * @param  {Number} chainCount amount of chained nodes since the parent node
   * @param  {Number} top        y coordinate of the parent node
   * @param  {Number} mode       MODE_NORMAL or MODE_NOCHAIN
   * @return {Number}            y coordinate of the current decision node's child
   */
  calculateChildTop(chainCount: number, top: number, mode: AbstractTreeMode): number {
    return this.calculateTop(chainCount, top, mode) + this.nodeDistance;
  }

  /**
   * Add a node to the node list, so it can be drawn later.
   * @param {Number} x
   * @param {Number} y
   * @param {Number} id AbstractNodeType id
   */
  addNode(x: number, y: number, id: number): void {
    this.nodeList.push({ x, y, id });
  }

  /**
   * Iterate the node list and draw all nodes onto the canvas.
   */
  drawAllNodes(): void {
    this.nodeList.map(({ x, y, id }) => this.drawNode(x, y, id));
  }

  /**
   * Draw a single node onto the canvas.
   * Take active state and comment into consideration.
   * @param  {Number} x
   * @param  {Number} y
   * @param  {Number} id AbstractNodeType id
   */
  drawNode(x: number, y: number, id: number): void {
    this.ctx.beginPath();

    this.ctx.fillStyle = VG_COLOR;
    if (this.nodeIdHasComment(id)) {
      this.ctx.fillStyle = COMMENT_COLOR;
    }

    let radius = NODE_RADIUS;
    if (id === this.activeNodeId) {
      radius *= 2;
    }

    this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
    this.ctx.fill();
  }

  /**
   * Draw an edge of the tree (a connector line) onto the canvas.
   * @param  {Number} x1 start coordinate
   * @param  {Number} y1
   * @param  {Number} x2 end coordinate
   * @param  {Number} y2
   */
  drawEdge(x1: number, y1: number, x2: number, y2: number): void {
    this.ctx.beginPath();
    this.ctx.strokeStyle = VG_COLOR;
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
  }

  /**
   * Draw a dashed edge, which indicates a straight chain of nodes.
   * Take active state into consideration.
   * @param  {Number} x
   * @param  {Number} top         start y coordinate
   * @param  {Number} bottom      end y coordinate
   * @param  {Boolean} emphasize  draw in bold outline when active node is in the chain
   */
  drawChainIndicator(x: number, top: number, bottom: number, emphasize: boolean = false): void {
    const dashLength = (bottom - top) / 7;
    if (emphasize) {
      this.ctx.lineWidth = 4;
    }
    this.ctx.beginPath();
    this.ctx.strokeStyle = VG_COLOR;
    for (const i of [0, 1, 2]) {
      this.ctx.moveTo(x, top + (2 * i + 1) * dashLength);
      this.ctx.lineTo(x, top + (2 * i + 2) * dashLength);
    }
    this.ctx.stroke();
    this.ctx.lineWidth = 1;
  }

  /**
   *
   * @param   {String} message
   */
  drawErrorMessage(message: string) {
    this.ctx.font = "16px serif";
    this.ctx.fillText(message, 10, 50);
  }

  /**
   * Checks if a node is commented.
   * @param  {Number} id AbstractNodeType id
   * @return {Boolean}    true if node is commented
   */
  nodeIdHasComment(id: number): boolean {
    return _.find(this.tree.comments, { node: id }) != null;
  }

  /**
   * Traverse the tree and add a width property for each node
   * which indicates the number of all leaves in the tree.
   * @param  {AbstractNodeType}   tree
   * @return {Number}       width of the tree
   */
  recordWidths(tree: AbstractNode): number {
    // Because any node with children.length == 1 has
    // the same width as its child, we can skip those.

    const decision = this.getNextDecision(tree);

    // Leaves just have a width of one
    if (decision.isLeaf) {
      decision.node.width = 1;
      return 1;
    }

    // Branchpoints are as wide as its children combined.
    // But actually, we need the width of the children
    // edge case: system is made for binary trees only
    let width = 0;
    for (const child of decision.node.children.slice(0, 2)) {
      child.width = this.recordWidths(child);
      width += child.width;
    }

    return width;
  }

  /**
   * Recursively calculate the maximum depth of a AbstractNodeType tree.
   * @param  {AbstractNodeType} tree
   * @param  {Number} mode      MODE_NORMAL or MODE_NOCHAIN
   * @param  {Number} count     helper count, current depth
   * @return {Number}           depth of the tree
   */
  getMaxTreeDepth(tree: AbstractNode, mode: AbstractTreeMode, count: number = 0): number {
    if (mode == null) {
      mode = MODE_NORMAL;
    }

    if (tree == null) {
      return count;
    }

    // current tree is a decision point
    count++;

    // find next decision point
    const decision = this.getNextDecision(tree);
    if (mode === MODE_NOCHAIN) {
      decision.chainCount = Math.min(decision.chainCount, 2);
    }
    count += decision.chainCount;

    // bottom reached, done.
    if (decision.isLeaf) {
      return count;
    }

    // traverse further and compare left & right subtree
    if (decision.isBranch) {
      return Math.max(
        this.getMaxTreeDepth(decision.node.children[0], mode, count),
        this.getMaxTreeDepth(decision.node.children[1], mode, count),
      );
    }

    // current decision point is a comment, follow the current chain
    return this.getMaxTreeDepth(decision.node.children[0], mode, count);
  }

  /**
   * Clear the background of the canvas.
   */
  clearBackground(): void {
    return this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Set width and height of the canvas object.
   * @param {Number} width
   * @param {Number} height
   */
  setDimensions(width: number, height: number): void {
    this.canvas.style.height = `${height}px`;
    this.canvas.width = width;
    this.canvas.height = height;
  }
}

export default AbstractTreeRenderer;
