import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import React from "react";
import { render } from "react-dom";
import Store from "oxalis/store";
import { setActiveNodeAction, setCommentForNodeAction } from "oxalis/model/actions/skeletontracing_actions";
import { InputKeyboardNoLoop } from "libs/input";
import Utils from "libs/utils";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import CommentList from "./comment_list";

class CommentTabView extends Marionette.View {

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
    Store.subscribe(() => {
      this.updateInputElement();
      this.updateState();
    });

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
        <CommentList />,
        this.ui.commentList[0],
      );
      this.updateState();
    }

    // scroll active comment into view
    this.ensureActiveCommentVisible();
  }


  updateState() {
    if (!this.commentList) { return; }
    const { trees, activeTreeId, activeNodeId } = Store.getState().skeletonTracing;
    this.commentList.setState({
      activeNodeId,
      activeTreeId,
      data: _.sortBy(trees, "treeId"),
      isSortedAscending: this.isSortedAscending,
    });
  }


  ensureActiveCommentVisible() {
    const activeNodeId = this.getActiveNodeId();
    const comment = $(`#comment-tab-node-${activeNodeId}`)[0];
    if (comment) { scrollIntoViewIfNeeded(comment); }
  }


  getActiveNodeId() {
    return Store.getState().skeletonTracing.activeNodeId;
  }


  getActiveTreeId() {
    return Store.getState().skeletonTracing.activeTreeId;
  }


  setActiveComment(comment, treeId) {
    this.activeComment = this.makeComment(comment, treeId);
  }


  getCommentForNode(nodeId, treeId) {
    if (!treeId) { treeId = Store.getState().skeletonTracing.activeTreeId; }
    //return Store.getState().skeletonTracing.getCommentForNode(nodeId, treeId);
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


  setComment(commentText: string, nodeId: number) {
    if (!nodeId) { nodeId = Store.getState().skeletonTracing.activeNodeId(); }
    // don't add a comment if there is no node
    if (!nodeId) { return; }

    Store.dispatch(setCommentForNodeAction(nodeId, commentText));
    this.updateState();
  }


  nextComment(forward = true) {
    let trees;
    const sortAscending = forward ? this.isSortedAscending : !this.isSortedAscending;

    const { activeComment } = this;

    // get tree of active comment or activeTree if there is no active comment
    let nextTree = Store.getState().skeletonTracing.trees[activeComment.treeId];
    nextTree.comments.sort(Utils.compareBy("node", sortAscending));

    // try to find next comment for this tree
    let nextComment = _.find(nextTree.comments,
      comment => this.commentComparator(comment, sortAscending) > this.commentComparator(activeComment.comment, sortAscending));

    // try to find next tree with at least one comment
    if (!nextComment) {
      trees = _.sortBy(Store.getState().skeletonTracing.trees, "treeId");
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
      this.setActiveComment(nextComment, nextTree.treeId);
      Store.dispatch(setActiveNodeAction(nextComment.node, false, true));
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
      treeId = this.getActiveTreeId();
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
