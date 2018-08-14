/**
 * comment_tab_view.js
 * @flow
 */

import _ from "lodash";
import * as React from "react";
import Maybe from "data.maybe";
import Utils from "libs/utils";
import update from "immutability-helper";
import Store from "oxalis/store";
import { connect } from "react-redux";
import { Input, Menu, Dropdown, Tooltip, Icon, Modal, Button, Row, Col } from "antd";
import ButtonComponent from "oxalis/view/components/button_component";
import InputComponent from "oxalis/view/components/input_component";
import { InputKeyboard } from "libs/input";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { getActiveTree, getActiveNode } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  setActiveNodeAction,
  createCommentAction,
  deleteCommentAction,
} from "oxalis/model/actions/skeletontracing_actions";
import TreeWithComments from "oxalis/view/right-menu/comment_tab/tree_with_comments";
import { Comment, MarkdownComment } from "oxalis/view/right-menu/comment_tab/comment";
import { AutoSizer, List } from "react-virtualized";
import Enum from "Enumjs";
import messages from "messages";
import type { Dispatch } from "redux";
import type { OxalisState, SkeletonTracingType, TreeType, CommentType } from "oxalis/store";
import type { Comparator } from "libs/utils";
import { makeSkeletonTracingGuard } from "oxalis/view/guards";
import SearchPopover from "../search_popover";

const InputGroup = Input.Group;

const treeTypeHint = ([]: Array<TreeType>);
const commentTypeHint = ([]: Array<CommentType>);

const SortByEnum = Enum.make({
  NAME: "NAME",
  ID: "ID",
  NATURAL: "NATURAL",
});
type SortByEnumType = $Keys<typeof SortByEnum>;

type SortOptionsType = {
  sortBy: SortByEnumType,
  isSortedAscending: boolean,
};
function getTreeSorter({ sortBy, isSortedAscending }: SortOptionsType): Comparator<TreeType> {
  return sortBy === SortByEnum.ID
    ? Utils.compareBy(treeTypeHint, "treeId", isSortedAscending)
    : Utils.localeCompareBy(
        treeTypeHint,
        tree => `${tree.name}_${tree.treeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

function getCommentSorter({ sortBy, isSortedAscending }: SortOptionsType): Comparator<CommentType> {
  return sortBy === SortByEnum.ID
    ? Utils.compareBy(([]: Array<CommentType>), "nodeId", isSortedAscending)
    : Utils.localeCompareBy(
        commentTypeHint,
        comment => `${comment.content}_${comment.nodeId}`,
        isSortedAscending,
        sortBy === SortByEnum.NATURAL,
      );
}

type Props = {
  skeletonTracing: SkeletonTracingType,
  setActiveNode: (nodeId: number) => void,
  deleteComment: () => void,
  createComment: (text: string) => void,
};

type CommentTabStateType = {
  isSortedAscending: boolean,
  sortBy: SortByEnumType,
  data: Array<TreeType | CommentType>,
  collapsedTreeIds: { [number]: boolean },
  isMarkdownModalVisible: boolean,
};

class CommentTabView extends React.PureComponent<Props, CommentTabStateType> {
  listRef: ?List;

  static getDerivedStateFromProps(
    props: Props,
    state: CommentTabStateType,
  ): $Shape<CommentTabStateType> {
    const sortedTrees = _.values(props.skeletonTracing.trees)
      .filter(tree => tree.comments.length > 0)
      .sort(getTreeSorter(state));

    const data = sortedTrees.reduce((result, tree) => {
      result.push(tree);
      const isCollapsed = state.collapsedTreeIds[tree.treeId];
      return isCollapsed
        ? result
        : result.concat(tree.comments.slice().sort(getCommentSorter(state)));
    }, []);

    return { data };
  }

  state = {
    isSortedAscending: true,
    sortBy: SortByEnum.NAME,
    data: [],
    // TODO: Remove once https://github.com/yannickcr/eslint-plugin-react/issues/1751 is merged
    // eslint-disable-next-line react/no-unused-state
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

  storePropertyUnsubscribers: Array<() => void> = [];

  keyboard = new InputKeyboard(
    {
      n: () => this.nextComment(),
      p: () => this.previousComment(),
    },
    { delay: Store.getState().userConfiguration.keyboardDelay },
  );

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
        (tree: TreeType): Array<CommentType> =>
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
    return Utils.zipMaybe(
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
        <Modal
          key="comment-markdown-modal"
          title={
            <span>
              Edit Comment (
              <a href="https://markdown-it.github.io/" target="_blank" rel="noopener noreferrer">
                Markdown enabled
              </a>
              )
            </span>
          }
          visible={this.state.isMarkdownModalVisible}
          onCancel={onOk}
          closable={false}
          width={700}
          footer={[
            <Button key="back" onClick={onOk}>
              Ok
            </Button>,
          ]}
        >
          <Row gutter={16}>
            <Col span={12}>
              <InputComponent
                value={comment.content}
                onChange={this.handleChangeInput}
                placeholder="Add comment"
                rows={5}
                autosize={{ minRows: 5, maxRows: 20 }}
                isTextArea
              />
            </Col>
            <Col span={12} style={{ maxHeight: 430, overflowY: "auto" }}>
              <MarkdownComment comment={comment} />
            </Col>
          </Row>
        </Modal>
      ))
      .getOrElse(null);
  }

  renderSortIcon() {
    const sortAsc = this.state.isSortedAscending;
    const sortNumeric = this.state.sortBy === SortByEnum.ID;
    const iconClass = `fa fa-sort-${sortNumeric ? "numeric" : "alpha"}-${sortAsc ? "asc" : "desc"}`;
    return <i className={iconClass} />;
  }

  renderSortDropdown() {
    return (
      <Menu selectedKeys={[this.state.sortBy]} onClick={this.handleChangeSorting}>
        <Menu.Item key={SortByEnum.NAME}>by name</Menu.Item>
        <Menu.Item key={SortByEnum.ID}>by creation time</Menu.Item>
        <Menu.Item key={SortByEnum.NATURAL}>
          by name (natural sort)<Tooltip
            title={messages["tracing.natural_sorting"]}
            placement="bottomLeft"
          >
            {" "}
            <Icon type="info-circle" />
          </Tooltip>
        </Menu.Item>
      </Menu>
    );
  }

  renderRow = ({ index, key, style }) => {
    if (this.state.data[index].treeId != null) {
      const tree = this.state.data[index];
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
      const comment = this.state.data[index];
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

    // If the activeNode has a comment, scroll to it,
    // otherwise scroll to the activeTree
    const scrollIndex = _.findIndex(
      this.state.data,
      activeCommentMaybe.isJust ? findCommentIndexFn : findTreeIndexFn,
    );

    return (
      <div className="flex-column">
        {this.renderMarkdownModal()}
        <InputGroup compact>
          <SearchPopover
            onSelect={nodeIdString => this.props.setActiveNode(parseInt(nodeIdString, 10))}
            data={_.flatMap(this.props.skeletonTracing.trees, tree => tree.comments)}
            idKey="nodeId"
            searchKey="content"
            maxSearchResults={10}
          >
            <Tooltip title="Open the search via CTRL + Shift + F">
              <ButtonComponent>
                <Icon type="search" />
              </ButtonComponent>
            </Tooltip>
          </SearchPopover>
          <ButtonComponent onClick={this.previousComment}>
            <i className="fa fa-arrow-left" />
          </ButtonComponent>
          <InputComponent
            value={activeCommentContent}
            disabled={activeNodeMaybe.isNothing}
            onChange={evt => this.handleChangeInput(evt, true)}
            onPressEnter={evt => evt.target.blur()}
            placeholder="Add comment"
            style={{ width: "60%" }}
          />
          {"Disable until the backend supports multiline comments" && false ? (
            <ButtonComponent
              onClick={() => this.setMarkdownModalVisibility(true)}
              disabled={activeNodeMaybe.isNothing}
              type={isMultilineComment ? "primary" : "button"}
            >
              <Icon type="edit" />Markdown
            </ButtonComponent>
          ) : null}
          <ButtonComponent onClick={this.nextComment}>
            <i className="fa fa-arrow-right" />
          </ButtonComponent>
          <Dropdown overlay={this.renderSortDropdown()}>
            <ButtonComponent title="Sort" onClick={this.toggleSortingDirection}>
              {this.renderSortIcon()}
            </ButtonComponent>
          </Dropdown>
        </InputGroup>
        <div style={{ flex: "1 1 auto", marginTop: 20 }}>
          <AutoSizer>
            {({ height, width }) => (
              <div style={{ height, width }} className="flex-overflow">
                <List
                  id="comment-list"
                  height={height}
                  width={width}
                  rowCount={this.state.data.length}
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

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(makeSkeletonTracingGuard(CommentTabView));
