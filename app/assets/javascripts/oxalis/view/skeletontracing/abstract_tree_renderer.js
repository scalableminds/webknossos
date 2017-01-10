import _ from "lodash";
import Backbone from "backbone";
import app from "app";
import Constants from "oxalis/constants";
import Toast from "libs/toast";


class AbstractTreeRenderer {
  static initClass() {
    this.prototype.NODE_RADIUS = 2;
    this.prototype.MAX_NODE_DISTANCE = 100;
    this.prototype.CLICK_TRESHOLD = 6;

    this.prototype.MODE_NORMAL = 0;     // draw every node and the complete tree
    this.prototype.MODE_NOCHAIN = 1;     // draw only decision points

    this.prototype.RENDER_COMMENTS = true;  // draw comments into tree
  }

  constructor($canvas) {
    this.getIdFromPos = this.getIdFromPos.bind(this);
    _.extend(this, Backbone.Events);

    this.canvas = $canvas;
    this.ctx = $canvas[0].getContext("2d");
    this.ctx.lineWidth = 1;
    this.nodeList = [];
  }


  /**
   * Render function called by events and GUI.
   * Draws the abstract tree, emphasizes the active node
   * and highlights comments, if enabled.
   * @param  {TraceTree} tree
   * @param  {Number} @activeNodeId TracePoint id
  */
  drawTree(tree1, activeNodeId) {
    let root;
    this.tree = tree1;
    this.activeNodeId = activeNodeId;
    const { tree } = this;
    if (tree == null) {
      return;
    }

    this.setDimensions(this.canvas.width(), this.canvas.height());
    this.clearBackground();
    this.setupColors();

    // List of {x : ..., y : ..., id: ...} objects
    this.nodeList = [];

    // set global mode
    const mode = this.MODE_NOCHAIN;

    // TODO: Actually, I though that buildTree() is pretty heavy, but
    // I do not experience performance issues, even with large trees.
    // Still, this might not need to be done on every single draw...
    try {
      root = tree.buildTree();
    } catch (e) {
      console.log("Error:", e);
      if (e === "CyclicTree") {
        if (!this.cyclicTreeWarningIssued) {
          Toast.error(`Cyclic trees (Tree-ID: ${tree.treeId}) are not supported by webKnossos. Please check the .nml file.`);
          this.cyclicTreeWarningIssued = true;
        }
        return;
      }
    }

    if (root == null) {
      return;
    }

    this.nodeDistance = Math.min(this.canvas.height() / (this.getMaxTreeDepth(root, mode) + 1), this.MAX_NODE_DISTANCE);

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
    this.drawTreeWithWidths(root, this.NODE_RADIUS, this.canvas.width() - this.NODE_RADIUS, this.nodeDistance / 2, mode);

    // because of z layering all nodes have to be drawn last
    return this.drawAllNodes();
  }


  /**
   * Draws a whole tree inside the given borders.
   * Thus it fits on the canvas and scales as the tree grows.
   * @param  {TracePoint} tree
   * @param  {Number} left  left border in pixels
   * @param  {Number} right right border in pixels
   * @param  {Number} top   y coordinate in pixels
   * @param  {Number} mode  @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Object}       new middle and top coordinates in pixels
  */
  drawTreeWithWidths(tree, left, right, top, mode) {
    const decision = this.getNextDecision(tree);
    let middle = this.calculateMiddle(left, right);

    if (decision.isBranch) {
      middle = this.drawBranch(decision, left, right, top, mode);
    } else if (!decision.isLeaf) {
      middle = this.drawCommentChain(decision, left, right, top, mode);
    }

    if (mode === this.MODE_NORMAL || decision.chainCount < 3) {
      this.drawChainFromTo(top, middle, tree, decision);
    } else if (mode === this.MODE_NOCHAIN) {
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
   * @param  {TracePoint} tree
   * @return {Decision}
  */
  getNextDecision(tree) {
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
   * @param  {Number} mode     @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}          new middle coordinate in pixels
  */
  drawBranch(decision, left, right, top, mode) {
    const branchMiddle = this.calculateBranchMiddle(decision, left, right);
    const topChildren = this.calculateChildTop(decision.chainCount, top, mode);
    const leftTree = this.drawTreeWithWidths(decision.node.children[0], left, branchMiddle, topChildren, mode);
    const rightTree = this.drawTreeWithWidths(decision.node.children[1], branchMiddle, right, topChildren, mode);

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
   * @param  {Number} mode     @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}          new middle coordinate in pixels
  */
  drawCommentChain(decision, left, right, top, mode) {
    const topChild = this.calculateTop(decision.chainCount, top, mode);
    const extent = this.drawTreeWithWidths(decision.node, left, right, topChild, mode);
    return extent.middle;
  }


  /**
   * Draws a sequence of nodes and the edges in between.
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} left     x coordinate in pixels
   * @param  {TracePoint} tree
   * @param  {Decision} decision
  */
  drawChainFromTo(top, left, tree, decision) {
    // Draw the chain and the tree, connect them.
    let node = tree;
    return (() => {
      const result = [];
      for (const i of __range__(0, decision.chainCount, true)) {
        let item;
        this.addNode(left, top + (i * this.nodeDistance), node.id);
        node = node.children[0];
        if (i !== 0) {
          item = this.drawEdge(left, top + ((i - 1) * this.nodeDistance), left, top + (i * this.nodeDistance));
        }
        result.push(item);
      }
      return result;
    })();
  }


  /**
   * Draws the dashed chain indicator and the start and end nodes.
   * @param  {Number} top      y coordinate in pixels
   * @param  {Number} middle   middel x coordinate in pixels
   * @param  {TracePoint} tree
   * @param  {Decision} decision
  */
  drawChainWithChainIndicatorFromTo(top, middle, tree, decision) {
    this.addNode(middle, top, tree.id);
    this.drawEdge(middle, top, middle, top + (0.5 * this.nodeDistance));
    this.drawChainIndicator(middle, top + (0.5 * this.nodeDistance), top + (1.5 * this.nodeDistance), decision.hasActiveNode);
    this.drawEdge(middle, top + (1.5 * this.nodeDistance), middle, top + (2 * this.nodeDistance));
    return this.addNode(middle, top + (2 * this.nodeDistance), decision.node.id);
  }


  /**
   * Calculate middle that divides the left and right tree, if any.
   * Middle is weighted accordingly to the subtrees` widths.
   * @param  {Decision} decision
   * @param  {Number} left           left border in pixels
   * @param  {Number} right          right border in pixels
   * @return {Number}                middle in pixels
  */
  calculateBranchMiddle(decision, left, right) {
    const leftChild = decision.node.children[0];
    const rightChild = decision.node.children[1];
    return (((right - left) * leftChild.width) / (leftChild.width + rightChild.width)) + left;
  }


  /**
   * Calculate middle of a left and right border.
   * @param  {Number} left  left border in pixels
   * @param  {Number} right right border in pixels
   * @return {Number}       middle in pixels
  */
  calculateMiddle(left, right) {
    return (left + right) / 2;
  }


  /**
   * Calculate the y coordinate of a node.
   * @param  {Number} chainCount amount of chained nodes since the parent node
   * @param  {Number} top        y coordinate of the parent node
   * @param  {Number} mode       @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}            y coordinate of the current decision node
  */
  calculateTop(chainCount, top, mode) {
    if (mode === this.MODE_NORMAL || chainCount < 3) {
      return top + (chainCount * this.nodeDistance);
    } else if (mode === this.MODE_NOCHAIN) {
      return top + (2 * this.nodeDistance);
    }
  }


  /**
   * Calculate the y coordinate of the first child of a node.
   * @param  {Number} chainCount amount of chained nodes since the parent node
   * @param  {Number} top        y coordinate of the parent node
   * @param  {Number} mode       @MODE_NORMAL or @MODE_NOCHAIN
   * @return {Number}            y coordinate of the current decision node's child
  */
  calculateChildTop(chainCount, top, mode) {
    return this.calculateTop(chainCount, top, mode) + this.nodeDistance;
  }


  /**
   * Add a node to the node list, so it can be drawn later.
   * @param {Number} x
   * @param {Number} y
   * @param {Number} id TracePoint id
  */
  addNode(x, y, id) {
    return this.nodeList.push({ x, y, id });
  }


  /**
   * Iterate the node list and draw all nodes onto the canvas.
  */
  drawAllNodes() {
    return this.nodeList.map(({ x, y, id }) =>
      this.drawNode(x, y, id));
  }


  /**
   * Draw a single node onto the canvas.
   * Take active state, theme and comment into consideration.
   * @param  {Number} x
   * @param  {Number} y
   * @param  {Number} id TracePoint id
  */
  drawNode(x, y, id) {
    this.ctx.beginPath();

    this.ctx.fillStyle = this.vgColor;
    if (this.nodeIdHasComment(id)) {
      this.ctx.fillStyle = this.commentColor;
    }

    let radius = this.NODE_RADIUS;
    if (id === this.activeNodeId) {
      radius *= 2;
    }

    this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
    return this.ctx.fill();
  }


  /**
   * Draw an edge of the tree (a connector line) onto the canvas.
   * Take theme into consideration.
   * @param  {Number} x1 start coordinate
   * @param  {Number} y1
   * @param  {Number} x2 end coordinate
   * @param  {Number} y2
  */
  drawEdge(x1, y1, x2, y2) {
    this.ctx.beginPath();
    this.ctx.strokeStyle = this.vgColor;
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    return this.ctx.stroke();
  }


  /**
   * Draw a dashed edge, which indicates a straight chain of nodes.
   * Take active state and theme into consideration.
   * @param  {Number} x
   * @param  {Number} top         start y coordinate
   * @param  {Number} bottom      end y coordinate
   * @param  {Boolean} emphasize  draw in bold outline when active node is in the chain
  */
  drawChainIndicator(x, top, bottom, emphasize = false) {
    const dashLength = (bottom - top) / 7;
    if (emphasize) {
      this.ctx.lineWidth = 4;
    }
    this.ctx.beginPath();
    this.ctx.strokeStyle = this.vgColor;
    for (const i of [0, 1, 2]) {
      this.ctx.moveTo(x, top + (((2 * i) + 1) * dashLength));
      this.ctx.lineTo(x, top + (((2 * i) + 2) * dashLength));
    }
    this.ctx.stroke();
    return this.ctx.lineWidth = 1;
  }


  /**
   * Checks if a node is commented (RENDER_COMMENTS has to be true).
   * @param  {Number} id TracePoint id
   * @return {Boolean}    true if node is commented
  */
  nodeIdHasComment(id) {
    return this.RENDER_COMMENTS && _.find(this.tree.comments, { node: id });
  }


  /**
   * Traverse the tree and add a width property for each node
   * which indicates the number of all leaves in the tree.
   * @param  {TracePoint}   tree
   * @return {Number}       width of the tree
  */
  recordWidths(tree) {
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
   * Recursively calculate the maximum depth of a TracePoint tree.
   * @param  {TracePoint} tree
   * @param  {Number} mode      @MODE_NORMAL or @MODE_NOCHAIN
   * @param  {Number} count     helper count, current depth
   * @return {Number}           depth of the tree
  */
  getMaxTreeDepth(tree, mode, count = 0) {
    if (mode == null) { mode = this.MODE_NORMAL; }

    if (!tree) {
      return count;
    }

    // current tree is a decision point
    count++;

    // find next decision point
    const decision = this.getNextDecision(tree);
    if (mode === this.MODE_NOCHAIN) {
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
   * Get the id of a TracePoint from a position on the canvas.
   * @param  {Number} x
   * @param  {Number} y
   * @return {Number}   TracePoint id
  */
  getIdFromPos(x, y) {
    for (const entry of this.nodeList) {
      if (Math.abs(x - entry.x) <= this.CLICK_TRESHOLD &&
          Math.abs(y - entry.y) <= this.CLICK_TRESHOLD) {
        return entry.id;
      }
    }
  }


  /**
   * Clear the background of the canvas.
  */
  clearBackground() {
    return this.ctx.clearRect(0, 0, this.canvas.width(), this.canvas.height());
  }


  /**
   * Apply a color theme according to the overall oxalis theme for
   *  - comments
   *  - nodes & edges
  */
  setupColors() {
    // apply color scheme
    if (app.oxalis.view.theme === Constants.THEME_BRIGHT) {
      this.vgColor = "black";
      return this.commentColor = "red";
    } else {
      this.vgColor = "white";
      return this.commentColor = "blue";
    }
  }


  /**
   * Setter.
   * @param  {Boolean} renderComments true, if abstract tree should show comments
  */
  renderComments(renderComments) {
    return this.RENDER_COMMENTS = renderComments;
  }


  /**
   * Set width and height of the canvas object.
   * @param {Number} width
   * @param {Number} height
  */
  setDimensions(width, height) {
    this.canvas[0].width = width;
    return this.canvas[0].height = height;
  }
}
AbstractTreeRenderer.initClass();


export default AbstractTreeRenderer;

function __range__(left, right, inclusive) {
  const range = [];
  const ascending = left < right;
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
