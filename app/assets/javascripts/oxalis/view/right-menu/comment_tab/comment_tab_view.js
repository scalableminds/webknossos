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
import { Icon, Input } from "antd";
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
const { TextArea } = Input;

const treeTypeHint = ([]: Array<TreeType>);
const commentTypeHint = ([]: Array<CommentType>);

type SortOptionsType = {
  isSortedByName: boolean,
  isSortedAscending: boolean,
};
function getTreeSorter({ isSortedByName, isSortedAscending }: SortOptionsType): Function {
  return isSortedByName
    ? Utils.localeCompareBy(treeTypeHint, tree => `${tree.name}_${tree.treeId}`, isSortedAscending)
    : Utils.compareBy(treeTypeHint, "treeId", isSortedAscending);
}

function getCommentSorter({ isSortedByName, isSortedAscending }: SortOptionsType): Function {
  return isSortedByName
    ? Utils.localeCompareBy(
        commentTypeHint,
        comment => `${comment.content}_${comment.nodeId}`,
        isSortedAscending,
      )
    : Utils.compareBy(([]: Array<CommentType>), "nodeId", isSortedAscending);
}

type Props = {
  skeletonTracing: SkeletonTracingType,
  setActiveNode: (nodeId: number) => void,
  deleteComment: () => void,
  createComment: (text: string) => void,
};

type CommentTabStateType = {
  isSortedAscending: boolean,
  isSortedByName: boolean,
  data: Array<TreeType | CommentType>,
  collapsedTreeIds: { [number]: boolean },
};

class CommentTabView extends React.PureComponent<Props, CommentTabStateType> {
  static getDerivedStateFromProps(
    props: Props,
    state: CommentTabStateType,
  ): $Shape<CommentTabStateType> {
    console.time("derive");
    const sortedTrees = _.values(props.skeletonTracing.trees)
      .filter(tree => tree.comments.length > 0)
      .sort(getTreeSorter(state));

    const data = sortedTrees.reduce((result, tree) => {
      result.push(tree);
      const isCollapsed = state.collapsedTreeIds[tree.treeId];
      return isCollapsed
        ? result
        : result.concat(tree.comments.slice(0).sort(getCommentSorter(state)));
    }, []);
    console.timeEnd("derive");

    return { data };
  }

  state = {
    isSortedAscending: true,
    isSortedByName: true,
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
      const { isSortedAscending, isSortedByName } = this.state;
      const sortAscending = forward ? isSortedAscending : !isSortedAscending;
      const { trees } = this.props.skeletonTracing;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = _.values(trees)
        .slice(0)
        .sort(getTreeSorter({ isSortedByName, isSortedAscending: sortAscending }));

      const sortedComments = _.flatMap(
        sortedTrees,
        (tree: TreeType): Array<CommentType> =>
          tree.comments
            .slice(0)
            .sort(getCommentSorter({ isSortedByName, isSortedAscending: sortAscending })),
      );

      const currentCommentIndex = _.findIndex(sortedComments, { nodeId: activeNode.id });
      const nextCommentIndex = (currentCommentIndex + 1) % sortedComments.length;

      if (nextCommentIndex >= 0 && nextCommentIndex < sortedComments.length) {
        this.props.setActiveNode(sortedComments[nextCommentIndex].nodeId);
      }
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
    // Cycle between isSortedAscending, !isSortedAscending and !isSortedByName
    if (!this.state.isSortedByName) {
      this.setState({
        isSortedAscending: true,
        isSortedByName: true,
      });
      return;
    }
    if (!this.state.isSortedAscending) {
      this.setState({
        isSortedAscending: true,
        isSortedByName: false,
      });
    } else {
      this.setState({
        isSortedAscending: false,
        isSortedByName: true,
      });
    }
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
        const isActive = comment.nodeId === this.props.skeletonTracing.activeNodeId;
        return <Comment key={key} style={style} comment={comment} isActive={isActive} />;
      }
    };

    return (
      <div className="flex-column">
        <InputGroup compact>
          <ButtonComponent onClick={this.previousComment}>
            <i className="fa fa-arrow-left" />
          </ButtonComponent>
          <TextArea
            value={activeComment}
            onChange={this.handleChangeInput}
            placeholder="Add comment"
            style={{ width: "60%", resize: "none", overflowY: "auto" }}
            rows={1}
          />
          <ButtonComponent onClick={this.nextComment}>
            <i className="fa fa-arrow-right" />
          </ButtonComponent>
          <ButtonComponent onClick={this.handleChangeSorting} title="sort">
            {this.state.isSortedByName ? <i className={sortingIconClass} /> : <Icon type="minus" />}
          </ButtonComponent>
        </InputGroup>
        <div style={{ flex: "1 1 auto", marginTop: 20 }}>
          <AutoSizer>
            {({ height, width }) => (
              <div style={{ height, width }} className="flex-overflow">
                <List
                  id="comment-list"
                  height={height}
                  width={width}
                  rowCount={rowCount}
                  rowHeight={21}
                  rowRenderer={rowRenderer}
                  scrollToIndex={scrollIndex > -1 ? scrollIndex : undefined}
                  tabIndex={null}
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
