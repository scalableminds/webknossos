/**
 * comment_tab_view.js
 * @flow
 */

import _ from "lodash";
import * as React from "react";
import Maybe from "data.maybe";
import Utils from "libs/utils";
import update from "immutability-helper";
import { connect } from "react-redux";
import { Input } from "antd";
import InputComponent from "oxalis/view/components/input_component";
import ButtonComponent from "oxalis/view/components/button_component";
import { InputKeyboardNoLoop } from "libs/input";
import { getActiveTree, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  setActiveNodeAction,
  createCommentAction,
  deleteCommentAction,
} from "oxalis/model/actions/skeletontracing_actions";
import TreeWithComments from "oxalis/view/right-menu/comment_tab/tree_with_comments";
import Comment from "oxalis/view/right-menu/comment_tab/comment";
import { AutoSizer, List } from "react-virtualized";
import type { Dispatch } from "redux";
import type { OxalisState, SkeletonTracingType, TreeType, CommentType } from "oxalis/store";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";

const InputGroup = Input.Group;

const treeTypeHint = ([]: TreeType[]);

type Props = {
  skeletonTracing: SkeletonTracingType,
  setActiveNode: (nodeId: number) => void,
  deleteComment: () => void,
  createComment: (text: string) => void,
};

type CommentTabStateType = {
  isSortedAscending: boolean,
  data: Array<TreeType | CommentType>,
  collapsedTreeIds: { [number]: boolean },
};

class CommentTabView extends React.PureComponent<Props, CommentTabStateType> {
  static getDerivedStateFromProps(
    nextProps: Props,
    prevState: CommentTabStateType,
  ): $Shape<CommentTabStateType> {
    console.time("derive");
    const sortedTrees = _.values(nextProps.skeletonTracing.trees)
      .filter(tree => tree.comments.length > 0)
      .sort(Utils.localeCompareBy(treeTypeHint, "name", prevState.isSortedAscending));

    const data = sortedTrees.reduce((result, tree) => {
      result.push(tree);
      const isCollapsed = prevState.collapsedTreeIds[tree.treeId];
      return isCollapsed
        ? result
        : result.concat(
            tree.comments
              .slice(0)
              .sort(
                Utils.localeCompareBy(
                  ([]: Array<CommentType>),
                  "content",
                  prevState.isSortedAscending,
                ),
              ),
          );
    }, []);
    console.timeEnd("derive");

    return { data };
  }

  state = {
    isSortedAscending: true,
    data: [],
    // TODO: Remove once https://github.com/yannickcr/eslint-plugin-react/issues/1751 is merged
    // eslint-disable-next-line react/no-unused-state
    collapsedTreeIds: {},
  };

  componentWillUnmount() {
    this.keyboard.destroy();
  }

  keyboard = new InputKeyboardNoLoop({
    n: () => this.nextComment(),
    p: () => this.previousComment(),
  });

  nextComment = (forward = true) => {
    getActiveNode(this.props.skeletonTracing).map(activeNode => {
      const sortAscending = forward ? this.state.isSortedAscending : !this.state.isSortedAscending;
      const { trees } = this.props.skeletonTracing;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = _.values(trees)
        .slice(0)
        .sort(Utils.localeCompareBy(treeTypeHint, "name", sortAscending));

      // eslint-disable-next-line prefer-arrow-callback
      const sortedComments = _.flatMap(
        sortedTrees,
        (tree: TreeType): Array<CommentType> =>
          tree.comments
            .slice(0)
            .sort(
              Utils.localeCompareBy(
                ([]: CommentType[]),
                comment => `${comment.content}_${comment.nodeId}`,
                sortAscending,
              ),
            ),
      );

      const currentCommentIndex = _.findIndex(sortedComments, { nodeId: activeNode.id });
      const nextCommentIndex = (currentCommentIndex + 1) % sortedComments.length;

      if (nextCommentIndex >= 0 && nextCommentIndex < sortedComments.length) {
        this.props.setActiveNode(sortedComments[nextCommentIndex].nodeId);
      }

      return null; // satisfy linter
    });
  };

  previousComment = () => {
    this.nextComment(false);
  };

  handleChangeInput = evt => {
    const commentText = evt.target.value;

    if (commentText) {
      this.props.createComment(commentText);
    } else {
      this.props.deleteComment();
    }
  };

  handleChangeSorting = () => {
    this.setState({
      isSortedAscending: !this.state.isSortedAscending,
    });
  };

  onExpand = (treeId: number) => {
    this.setState(prevState => ({
      collapsedTreeIds: update(prevState.collapsedTreeIds, { $toggle: [treeId] }),
    }));
  };

  render() {
    const activeComment = Utils.zipMaybe(
      getActiveTree(this.props.skeletonTracing),
      getActiveNode(this.props.skeletonTracing),
    )
      .chain(([tree, activeNode]) =>
        Maybe.fromNullable(tree.comments.find(comment => comment.nodeId === activeNode.id)),
      )
      .map(comment => comment.content)
      .getOrElse("");

    const findCommentIndexFn = commentOrTree =>
      commentOrTree.nodeId != null &&
      commentOrTree.nodeId === this.props.skeletonTracing.activeNodeId;
    const findTreeIndexFn = commentOrTree =>
      commentOrTree.treeId != null &&
      commentOrTree.treeId === this.props.skeletonTracing.activeTreeId;

    // If the activeNode has a comment, scroll to it,
    // otherwise scroll to the activeTree
    const scrollIndex = _.findIndex(
      this.state.data,
      activeComment !== "" ? findCommentIndexFn : findTreeIndexFn,
    );

    const sortingIconClass = this.state.isSortedAscending
      ? "fa fa-sort-alpha-asc"
      : "fa fa-sort-alpha-desc";

    const rowCount = this.state.data.length;
    const rowHeight = 21;
    const rowRenderer = ({ index, key, style }) => {
      if (this.state.data[index].treeId != null) {
        const tree = this.state.data[index];
        return (
          <TreeWithComments
            key={key}
            style={style}
            tree={tree}
            collapsed={this.state.collapsedTreeIds[tree.treeId]}
            onExpand={this.onExpand}
            isActive={tree.treeId === this.props.skeletonTracing.activeTreeId}
          />
        );
      } else {
        const comment = this.state.data[index];
        return (
          <Comment
            key={key}
            style={style}
            comment={comment}
            isActive={comment.nodeId === this.props.skeletonTracing.activeNodeId}
          />
        );
      }
    };

    return (
      <div className="flex-column">
        <InputGroup compact>
          <ButtonComponent onClick={this.previousComment}>
            <i className="fa fa-arrow-left" />
          </ButtonComponent>
          <InputComponent
            value={activeComment}
            onChange={this.handleChangeInput}
            placeholder="Add comment"
            style={{ width: "60%" }}
          />
          <ButtonComponent onClick={this.nextComment}>
            <i className="fa fa-arrow-right" />
          </ButtonComponent>
          <ButtonComponent onClick={this.handleChangeSorting} title="sort">
            <i className={sortingIconClass} />
          </ButtonComponent>
        </InputGroup>
        <div style={{ flex: "1 1 auto", marginTop: 20 }}>
          <AutoSizer>
            {({ height, width }) => (
              <div id="comment-list" style={{ height, width }} className="flex-overflow">
                <List
                  height={height}
                  width={width}
                  rowCount={rowCount}
                  rowHeight={rowHeight}
                  rowRenderer={rowRenderer}
                  scrollToIndex={scrollIndex > -1 ? scrollIndex : undefined}
                />
              </div>
            )}
          </AutoSizer>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  skeletonTracing: state.tracing,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setActiveNode(nodeId) {
    dispatch(setActiveNodeAction(nodeId));
  },
  deleteComment() {
    dispatch(deleteCommentAction());
  },
  createComment(text) {
    dispatch(createCommentAction(text));
  },
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(makeSkeletonTracingGuard(CommentTabView));
