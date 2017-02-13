import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import React from "react";
import { render } from "react-dom";
import { InputKeyboardNoLoop } from "libs/input";
import Utils from "libs/utils";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import CommentList from "./comment_list";

class CommentTabView extends Marionette.View {
  constructor(...args) {
    super(...args);
    this.setActiveNode = this.setActiveNode.bind(this);
  }

  static initClass() {
    this.prototype.className = "flex-column";
    this.prototype.template = _.template(`\
<div class="input-group" id="comment-navbar">
  <div class="input-group-btn">
    <button class="btn btn-default" id="comment-previous"><i class="fa fa-arrow-left"></i></button>
  </div>
  <input class="form-control" id="comment-input" type="text" value="<%- activeComment.comment ? activeComment.comment.content : '' %>" placeholder="Add comment">
  <div class="input-group-btn">
    <button class="btn btn-default" id="comment-next"><i class="fa fa-arrow-right"></i></button>
    <button class="btn btn-default" id="comment-sort" title="sort">
      <% if(isSortedAscending){ %>
        <i class="fa fa-sort-alpha-asc"></i>
      <% } else { %>
        <i class="fa fa-sort-alpha-desc"></i>
      <% } %>
    </button>
  </div>
</div>
<ul id="comment-list" class="flex-overflow"></ul>\
`);


    this.prototype.ui = {
      commentInput: "input",
      commentList: "#comment-list",
    };

    this.prototype.events = {
      "click #comment-sort": "sortComments",
      "change input": "handleInput",
      "click #comment-list li": "setActive",
      "click #comment-next": "nextComment",
      "click #comment-previous": "previousComment",
    };
  }

  templateContext() {
    return {
      activeComment: this.activeComment,
      isSortedAscending: this.isSortedAscending,
    };
  }


  initialize() {
    this.activeComment = {};
    this.isSortedAscending = true;

    // select the activeNode if there is a comment...
    const comment = this.getCommentForNode(this.getActiveNodeId());
    if (comment) {
      this.activeComment = this.makeComment(comment);
    } else {
      // make null comment
      this.activeComment = this.makeComment();
    }

    // events
    this.listenTo(this.model.skeletonTracing, "newActiveNode", this.updateInputElement);
    this.listenTo(this.model.skeletonTracing, "reloadTrees", this.updateState);
    this.listenTo(this.model.skeletonTracing, "setComment", this.setComment);

    // keyboard shortcuts
    return new InputKeyboardNoLoop({
      n: () => this.nextComment(),
      p: () => this.previousComment(),
    });
  }


  render() {
    // tabs are not destroyed and a rerender would cause the react components to lose their state
    if (!this.commentList) {
      super.render();
      this.commentList = render(
        <CommentList onNewActiveNode={this.setActiveNode} />,
        this.ui.commentList[0],
      );
      this.updateState();
    }

    // scroll active comment into view
    this.ensureActiveCommentVisible();
  }


  updateState() {
    if (!this.commentList) { return; }

    this.commentList.setState({
      data: this.model.skeletonTracing.getTreesSortedBy("treeId", this.isSortedAscending),
      activeNodeId: this.getActiveNodeId(),
      activeTreeId: this.model.skeletonTracing.getActiveTreeId(),
      isSortedAscending: this.isSortedAscending,
    });
  }


  ensureActiveCommentVisible() {
    const activeNodeId = this.getActiveNodeId();
    const comment = $(`#comment-tab-node-${activeNodeId}`)[0];
    if (comment) { scrollIntoViewIfNeeded(comment); }
  }


  getActiveNodeId() {
    return this.model.skeletonTracing.getActiveNodeId();
  }


  setActiveNode(comment, treeId) {
    this.activeComment = this.makeComment(comment, treeId);
    this.model.skeletonTracing.setActiveNode(comment.node);
    this.model.skeletonTracing.centerActiveNode();
  }


  getCommentForNode(nodeId) {
    const activeTree = this.model.skeletonTracing.getActiveTree();
    return _.find(activeTree.comments, { node: nodeId });
  }


  updateInputElement(nodeId) {
    // responds to activeNode:change event
    const comment = this.getCommentForNode(nodeId);
    let content = "";
    if (comment) {
      this.activeComment = this.makeComment(comment);
      ({ content } = comment);
    }

    // populate the input element
    this.ui.commentInput.val(content);
    this.updateState();
  }


  handleInput(evt) {
    const commentText = $(evt.target).val();
    this.setComment(commentText);
  }


  setComment(commentText) {
    if (!this.model.skeletonTracing.restrictionHandler.updateAllowed()) { return; }

    // add, delete or update a comment
    const nodeId = this.getActiveNodeId();

    // don't add a comment if there is no active node
    if (!nodeId) { return; }

    const tree = this.model.skeletonTracing.getActiveTree();

    let comment = this.getCommentForNode(nodeId);
    if (comment) {
      if (commentText !== "") {
        comment.content = commentText;
      } else {
        tree.removeCommentWithNodeId(nodeId);
      }
      this.updateState();
    } else if (commentText !== "") {
      comment = {
        node: nodeId,
        content: commentText,
      };
      tree.comments.push(comment);

      this.setActiveNode(comment, tree.treeId);
    }

    this.model.skeletonTracing.updateTree(tree);
  }


  nextComment(forward = true) {
    let trees;
    const sortAscending = forward ? this.isSortedAscending : !this.isSortedAscending;

    const { activeComment } = this;

    // get tree of active comment or activeTree if there is no active comment
    let nextTree = this.model.skeletonTracing.getTree(activeComment.treeId);
    nextTree.comments.sort(Utils.compareBy("node", sortAscending));

    // try to find next comment for this tree
    let nextComment = _.find(nextTree.comments,
      comment => this.commentComparator(comment, sortAscending) > this.commentComparator(activeComment.comment, sortAscending));

    // try to find next tree with at least one comment
    if (!nextComment) {
      trees = this.model.skeletonTracing.getTreesSortedBy("treeId", sortAscending);
      nextTree = _.find(trees,
        tree => this.treeComparator(tree.treeId, sortAscending) > this.treeComparator(activeComment.treeId, sortAscending) && tree.comments.length);
    }

    // try to find any tree with at least one comment, starting from the beginning
    if (!nextTree) {
      nextTree = _.find(trees, tree => tree.comments.length);
    }

    if (!nextComment && nextTree) {
      nextTree.comments.sort(Utils.compareBy("node", sortAscending));
      nextComment = nextTree.comments[0];
    }

    // if a comment was found, make it active
    if (nextComment) {
      this.setActiveNode(nextComment, nextTree.treeId);
    }
  }


  previousComment() {
    this.nextComment(false);
  }


  sortComments() {
    this.isSortedAscending = !this.isSortedAscending;
    this.updateState();
  }


  // Helper functions

  makeComment(comment, treeId) {
    if (comment === undefined) {
      return { comment: { node: null }, treeId: null };
    }

    if (treeId === undefined) {
      treeId = this.model.skeletonTracing.getActiveTreeId();
    }

    return { comment, treeId };
  }


  commentComparator(comment, sortAscending) {
    const coefficient = sortAscending ? 1 : -1;
    return comment.node * coefficient;
  }


  treeComparator(treeId, sortAscending) {
    const coefficient = sortAscending ? 1 : -1;
    return treeId * coefficient;
  }
}
CommentTabView.initClass();


export default CommentTabView;
