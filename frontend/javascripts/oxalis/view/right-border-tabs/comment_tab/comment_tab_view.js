// @flow
import { AutoSizer, List } from "react-virtualized";
import type { Dispatch } from "redux";
import { Input, Menu, Dropdown, Tooltip } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  EditOutlined,
  InfoCircleOutlined,
  SearchOutlined,
  ShrinkOutlined,
} from "@ant-design/icons";
import { connect } from "react-redux";
import Enum from "Enumjs";
import Maybe from "data.maybe";
import * as React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";
import update from "immutability-helper";

import { Comment, commentListId } from "oxalis/view/right-border-tabs/comment_tab/comment";
import { type Comparator, compareBy, localeCompareBy, zipMaybe } from "libs/utils";
import { InputKeyboard } from "libs/input";
import { MarkdownModal } from "oxalis/view/components/markdown_modal";
import { cachedDiffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import { getActiveTree, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";
import {
  setActiveNodeAction,
  createCommentAction,
  deleteCommentAction,
} from "oxalis/model/actions/skeletontracing_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import InputComponent from "oxalis/view/components/input_component";
import Store, {
  type CommentType,
  type OxalisState,
  type SkeletonTracing,
  type Tree,
} from "oxalis/store";
import TreeWithComments from "oxalis/view/right-border-tabs/comment_tab/tree_with_comments";
import messages from "messages";

import AdvancedSearchPopover from "../advanced_search_popover";

const InputGroup = Input.Group;

const treeTypeHint = ([]: Array<Tree>);
const commentTypeHint = ([]: Array<CommentType>);

const commentTabId = "commentTabId";

const SortByEnum = Enum.make({
  NAME: "NAME",
  ID: "ID",
  NATURAL: "NATURAL",
});
type SortByEnumType = $Keys<typeof SortByEnum>;

type SortOptions = {
  sortBy: SortByEnumType,
  isSortedAscending: boolean,
};
function getTreeSorter({ sortBy, isSortedAscending }: SortOptions): Comparator<Tree> {
  return sortBy === SortByEnum.ID
    ? compareBy(treeTypeHint, tree => tree.treeId, isSortedAscending)
    : localeCompareBy(
        treeTypeHint,
        tree => `${tree.name}_${tree.treeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

function getCommentSorter({ sortBy, isSortedAscending }: SortOptions): Comparator<CommentType> {
  return sortBy === SortByEnum.ID
    ? compareBy(([]: Array<CommentType>), comment => comment.nodeId, isSortedAscending)
    : localeCompareBy(
        commentTypeHint,
        comment => `${comment.content}_${comment.nodeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

type StateProps = {|
  skeletonTracing: ?SkeletonTracing,
  setActiveNode: (nodeId: number) => void,
  deleteComment: () => void,
  createComment: (text: string) => void,
|};
type Props = {| ...StateProps |};
type PropsWithSkeleton = {| ...Props, skeletonTracing: SkeletonTracing |};

type CommentTabState = {
  isSortedAscending: boolean,
  sortBy: SortByEnumType,
  collapsedTreeIds: { [number]: boolean },
  isMarkdownModalVisible: boolean,
};

const RELEVANT_ACTIONS_FOR_COMMENTS = [
  "updateTree",
  "deleteTree",
  "mergeTree",
  "moveTreeComponent",
  "deleteEdge",
  "revertToVersion",
];

const memoizedDeriveData = memoizeOne(
  (trees, state: CommentTabState): Array<Tree | CommentType> => {
    const sortedTrees = _.values(trees)
      .filter(tree => tree.comments.length > 0)
      .sort(getTreeSorter(state));

    const commentSorter = getCommentSorter(state);

    const data = [];
    for (const tree of sortedTrees) {
      data.push(tree);
      const isCollapsed = state.collapsedTreeIds[tree.treeId];
      if (!isCollapsed && tree.comments.length > 0) {
        const sortedComments = tree.comments.slice().sort(commentSorter);

        // Don't use concat to avoid creating a new `data` array for each tree
        for (const comment of sortedComments) {
          data.push(comment);
        }
      }
    }

    return data;
  },
);

class CommentTabView extends React.Component<PropsWithSkeleton, CommentTabState> {
  listRef: ?typeof List;
  storePropertyUnsubscribers: Array<() => void> = [];
  keyboard = new InputKeyboard(
    {
      n: () => this.nextComment(),
      p: () => this.previousComment(),
    },
    { delay: Store.getState().userConfiguration.keyboardDelay },
  );

  state = {
    isSortedAscending: true,
    sortBy: SortByEnum.NAME,
    collapsedTreeIds: {},
    isMarkdownModalVisible: false,
  };

  componentDidMount() {
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        state => state.userConfiguration.keyboardDelay,
        keyboardDelay => {
          if (this.keyboard != null) {
            this.keyboard.delay = keyboardDelay;
          }
        },
      ),
    );
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (nextState !== this.state) {
      return true;
    }

    if (this.props.skeletonTracing.activeNodeId !== nextProps.skeletonTracing.activeNodeId) {
      return true;
    }
    if (this.props.skeletonTracing.activeTreeId !== nextProps.skeletonTracing.activeTreeId) {
      return true;
    }

    const updateActions = Array.from(
      cachedDiffTrees(this.props.skeletonTracing, nextProps.skeletonTracing),
    );

    const relevantUpdateActions = updateActions.filter(
      ua =>
        RELEVANT_ACTIONS_FOR_COMMENTS.includes(ua.name) ||
        (ua.name === "createTree" && ua.value.comments.length > 0),
    );
    return relevantUpdateActions.length > 0;
  }

  componentDidUpdate(prevProps) {
    if (
      this.listRef != null &&
      prevProps.skeletonTracing.trees !== this.props.skeletonTracing.trees
    ) {
      // Force the virtualized list to update if a comment was changed
      // as it only rerenders if the rowCount changed otherwise
      this.listRef.forceUpdateGrid();
    }
  }

  componentWillUnmount() {
    this.keyboard.destroy();
    this.unsubscribeStoreListeners();
  }

  nextComment = (forward: boolean = true) => {
    getActiveNode(this.props.skeletonTracing).map(activeNode => {
      const { isSortedAscending, sortBy } = this.state;
      const sortAscending = forward ? isSortedAscending : !isSortedAscending;
      const { trees } = this.props.skeletonTracing;

      // Create a sorted, flat array of all comments across all trees
      const sortedTrees = _.values(trees)
        .slice()
        .sort(getTreeSorter({ sortBy, isSortedAscending: sortAscending }));

      const sortedComments = _.flatMap(
        sortedTrees,
        (tree: Tree): Array<CommentType> =>
          tree.comments
            .slice()
            .sort(getCommentSorter({ sortBy, isSortedAscending: sortAscending })),
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

  handleChangeInput = (evt: SyntheticInputEvent<>, insertLineBreaks: boolean = false) => {
    const commentText = evt.target.value;

    if (commentText) {
      this.props.createComment(insertLineBreaks ? commentText.replace(/\\n/g, "\n") : commentText);
    } else {
      this.props.deleteComment();
    }
  };

  handleChangeSorting = ({ key }) => {
    this.setState({ sortBy: key });
  };

  toggleSortingDirection = () => {
    this.setState(prevState => ({
      isSortedAscending: !prevState.isSortedAscending,
    }));
  };

  toggleExpandForAllTrees = () => {
    this.setState(prevState => {
      const shouldBeCollapsed = !_.values(prevState.collapsedTreeIds).some(bool => bool);

      const collapsedTreeIds = shouldBeCollapsed
        ? _.mapValues(this.props.skeletonTracing.trees, () => true)
        : {};
      return {
        collapsedTreeIds,
      };
    });
  };

  toggleExpand = (treeId: number) => {
    this.setState(prevState => ({
      collapsedTreeIds: update(prevState.collapsedTreeIds, { $toggle: [treeId] }),
    }));
  };

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  getActiveComment(createIfNotExisting: boolean = false) {
    return zipMaybe(
      getActiveTree(this.props.skeletonTracing),
      getActiveNode(this.props.skeletonTracing),
    ).chain(([tree, activeNode]) =>
      Maybe.fromNullable(tree.comments.find(comment => comment.nodeId === activeNode.id)).orElse(
        () =>
          // If there is no active comment and createIfNotExisting is set, create an empty comment
          Maybe.fromNullable(
            createIfNotExisting
              ? {
                  nodeId: activeNode.id,
                  content: "",
                }
              : null,
          ),
      ),
    );
  }

  setMarkdownModalVisibility = (visible: boolean) => {
    this.setState({ isMarkdownModalVisible: visible });
  };

  renderMarkdownModal() {
    const activeCommentMaybe = this.getActiveComment(true);
    const onOk = () => this.setMarkdownModalVisibility(false);

    return activeCommentMaybe
      .map(comment => (
        <MarkdownModal
          key={comment.nodeId}
          source={comment.content}
          visible={this.state.isMarkdownModalVisible}
          onChange={this.handleChangeInput}
          onOk={onOk}
          label="Comment"
        />
      ))
      .getOrElse(null);
  }

  renderSortIcon() {
    const sortAsc = this.state.isSortedAscending;
    const sortNumeric = this.state.sortBy === SortByEnum.ID;
    const iconClass = `fas fa-sort-${sortNumeric ? "numeric" : "alpha"}-${sortAsc ? "down" : "up"}`;
    return <i className={iconClass} />;
  }

  renderSortDropdown() {
    return (
      <Menu selectedKeys={[this.state.sortBy]} onClick={this.handleChangeSorting}>
        <Menu.Item key={SortByEnum.NAME}>by name</Menu.Item>
        <Menu.Item key={SortByEnum.ID}>by creation time</Menu.Item>
        <Menu.Item key={SortByEnum.NATURAL}>
          by name (natural sort)
          <Tooltip title={messages["tracing.natural_sorting"]} placement="bottomLeft">
            {" "}
            <InfoCircleOutlined />
          </Tooltip>
        </Menu.Item>
      </Menu>
    );
  }

  getData(): Array<Tree | CommentType> {
    return memoizedDeriveData(this.props.skeletonTracing.trees, this.state);
  }

  renderRow = ({ index, key, style }) => {
    if (this.getData()[index].treeId != null) {
      const tree = this.getData()[index];
      return (
        <TreeWithComments
          key={key}
          style={style}
          tree={tree}
          collapsed={this.state.collapsedTreeIds[tree.treeId]}
          onExpand={this.toggleExpand}
          isActive={tree.treeId === this.props.skeletonTracing.activeTreeId}
        />
      );
    } else {
      const comment = this.getData()[index];
      const isActive = comment.nodeId === this.props.skeletonTracing.activeNodeId;
      return <Comment key={key} style={style} comment={comment} isActive={isActive} />;
    }
  };

  render() {
    const activeCommentMaybe = this.getActiveComment();
    // Replace line breaks as they will otherwise be stripped when shown in an input field
    const activeCommentContent = activeCommentMaybe
      .map(comment => comment.content)
      .getOrElse("")
      .replace(/\r?\n/g, "\\n");
    const isMultilineComment = activeCommentContent.indexOf("\\n") !== -1;
    const activeNodeMaybe = getActiveNode(this.props.skeletonTracing);

    const findCommentIndexFn = commentOrTree =>
      commentOrTree.nodeId != null &&
      commentOrTree.nodeId === this.props.skeletonTracing.activeNodeId;
    const findTreeIndexFn = commentOrTree =>
      commentOrTree.treeId != null &&
      commentOrTree.treeId === this.props.skeletonTracing.activeTreeId;

    return (
      <div
        id={commentTabId}
        className="flex-column padded-tab-content"
        style={{ height: "inherit" }}
      >
        <DomVisibilityObserver targetId={commentTabId}>
          {isVisibleInDom => {
            if (!isVisibleInDom && !this.state.isMarkdownModalVisible) {
              return null;
            }
            // If the activeNode has a comment, scroll to it,
            // otherwise scroll to the activeTree
            const scrollIndex = _.findIndex(
              this.getData(),
              activeCommentMaybe.isJust ? findCommentIndexFn : findTreeIndexFn,
            );

            return (
              <React.Fragment>
                {this.renderMarkdownModal()}
                <InputGroup compact>
                  <AdvancedSearchPopover
                    onSelect={comment => this.props.setActiveNode(comment.nodeId)}
                    data={_.flatMap(this.props.skeletonTracing.trees, tree => tree.comments)}
                    searchKey="content"
                    targetId={commentListId}
                  >
                    <ButtonComponent icon={<SearchOutlined />} title="Search through comments" />
                  </AdvancedSearchPopover>
                  <ButtonComponent
                    title="Jump to previous comment"
                    onClick={this.previousComment}
                    icon={<ArrowLeftOutlined />}
                  />
                  <InputComponent
                    value={activeCommentContent}
                    disabled={activeNodeMaybe.isNothing}
                    onChange={evt => this.handleChangeInput(evt, true)}
                    onPressEnter={evt => evt.target.blur()}
                    placeholder="Add comment"
                    style={{ width: "50%" }}
                  />
                  <ButtonComponent
                    onClick={() => this.setMarkdownModalVisibility(true)}
                    disabled={activeNodeMaybe.isNothing}
                    type={isMultilineComment ? "primary" : "button"}
                    icon={<EditOutlined />}
                    title="Open dialog to edit comment in multi-line mode"
                  />
                  <ButtonComponent
                    title="Jump to next comment"
                    onClick={this.nextComment}
                    icon={<ArrowRightOutlined />}
                  />
                  <Dropdown overlay={this.renderSortDropdown()} trigger={["click"]}>
                    <ButtonComponent title="Sort" onClick={this.toggleSortingDirection}>
                      {this.renderSortIcon()}
                    </ButtonComponent>
                  </Dropdown>
                  <ButtonComponent
                    onClick={this.toggleExpandForAllTrees}
                    icon={<ShrinkOutlined />}
                    title="Collapse or expand groups"
                  />
                </InputGroup>
                <div style={{ flex: "1 1 auto", marginTop: 20, listStyle: "none" }}>
                  <AutoSizer>
                    {({ height, width }) => (
                      <div style={{ height, width }} className="flex-overflow">
                        <List
                          id={commentListId}
                          height={height}
                          width={width}
                          rowCount={this.getData().length}
                          rowHeight={21}
                          rowRenderer={this.renderRow}
                          scrollToIndex={scrollIndex > -1 ? scrollIndex : undefined}
                          tabIndex={null}
                          ref={listEl => {
                            this.listRef = listEl;
                          }}
                        />
                      </div>
                    )}
                  </AutoSizer>
                </div>
              </React.Fragment>
            );
          }}
        </DomVisibilityObserver>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  skeletonTracing: state.tracing.skeleton,
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

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(makeSkeletonTracingGuard(CommentTabView));
