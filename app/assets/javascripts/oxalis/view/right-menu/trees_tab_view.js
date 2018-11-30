/**
 * list_tree_view.js
 * @flow
 */
import _ from "lodash";
import { Button, Dropdown, Input, Menu, Icon, Spin, Modal, Tooltip } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { saveAs } from "file-saver";
import * as React from "react";

import { getActiveTree, getActiveGroup } from "oxalis/model/accessors/skeletontracing_accessor";
import { getBuildInfo } from "admin/admin_rest_api";
import { readFileAsText } from "libs/read_file";
import { serializeToNml, getNmlName, parseNml } from "oxalis/model/helpers/nml_helpers";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import {
  setTreeNameAction,
  createTreeAction,
  deleteTreeAsUserAction,
  deleteMultipleTreesAsUserAction,
  shuffleTreeColorAction,
  shuffleAllTreeColorsAction,
  selectNextTreeAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
  setActiveTreeAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  addTreesAndGroupsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import messages from "messages";
import {
  createGroupToTreesMap,
  callDeep,
  MISSING_GROUP_ID,
} from "oxalis/view/right-menu/tree_hierarchy_view_helpers";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import InputComponent from "oxalis/view/components/input_component";
import Store, {
  type OxalisState,
  type SkeletonTracing,
  type Tracing,
  type TreeGroup,
  type UserConfiguration,
} from "oxalis/store";
import Toast from "libs/toast";
import TreeHierarchyView from "oxalis/view/right-menu/tree_hierarchy_view";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import SearchPopover from "./search_popover";
import DeleteGroupModalView from "./delete-group-modal-view";

const ButtonGroup = Button.Group;
const InputGroup = Input.Group;

type Props = {
  onShuffleTreeColor: number => void,
  onShuffleAllTreeColors: () => void,
  onSortTree: boolean => void,
  onSelectNextTreeForward: () => void,
  onSelectNextTreeBackward: () => void,
  onCreateTree: () => void,
  onDeleteTree: () => void,
  onDeleteMultipleTrees: (Array<number>) => void,
  onSetTreeGroup: (?number, number) => void,
  onUpdateTreeGroups: (Array<TreeGroup>) => void,
  onChangeTreeName: string => void,
  annotation: Tracing,
  skeletonTracing?: SkeletonTracing,
  userConfiguration: UserConfiguration,
  onSetActiveTree: number => void,
  showDropzoneModal: () => void,
};

type State = {
  isUploading: boolean,
  isDownloading: boolean,
  selectedTrees: Array<number>,
  groupToDelete: ?number,
};

export async function importNmls(files: Array<File>, createGroupForEachFile: boolean) {
  try {
    const { successes: importActions, errors } = await Utils.promiseAllWithErrors(
      files.map(async file => {
        const nmlString = await readFileAsText(file);
        try {
          const { trees, treeGroups } = await parseNml(
            nmlString,
            createGroupForEachFile ? file.name : null,
          );
          return addTreesAndGroupsAction(trees, treeGroups);
        } catch (e) {
          throw new Error(`"${file.name}" could not be parsed. ${e.message}`);
        }
      }),
    );

    if (errors.length > 0) {
      throw errors;
    }

    // Dispatch the actual actions as the very last step, so that
    // not a single store mutation happens if something above throws
    // an error
    importActions.forEach(action => Store.dispatch(action));
  } catch (e) {
    (Array.isArray(e) ? e : [e]).forEach(err => Toast.error(err.message));
  }
}

class TreesTabView extends React.PureComponent<Props, State> {
  state = {
    isUploading: false,
    isDownloading: false,
    selectedTrees: [],
    groupToDelete: null,
  };

  handleChangeTreeName = evt => {
    if (!this.props.skeletonTracing) {
      return;
    }
    const { activeGroupId } = this.props.skeletonTracing;
    if (activeGroupId != null) {
      api.tracing.renameGroup(activeGroupId, evt.target.value);
    } else {
      this.props.onChangeTreeName(evt.target.value);
    }
  };

  deleteGroup = (groupId: number, withTrees = false) => {
    if (!this.props.skeletonTracing) {
      return;
    }
    const { treeGroups, trees } = this.props.skeletonTracing;
    const newTreeGroups = _.cloneDeep(treeGroups);
    const groupToTreesMap = createGroupToTreesMap(trees);
    // Remove group
    callDeep(newTreeGroups, groupId, (item, index, parentsChildren, parentGroupId) => {
      // Remove group
      parentsChildren.splice(index, 1);
      if (!withTrees) {
        // move its group children to the parent group
        parentsChildren.push(...item.children);
      }
      const subtrees = groupToTreesMap[groupId] != null ? groupToTreesMap[groupId] : [];
      if (withTrees) {
        // also delete all subtrees
        this.props.onDeleteMultipleTrees(subtrees.map(tree => tree.treeId));
      } else {
        // update all subtrees
        for (const tree of subtrees) {
          this.props.onSetTreeGroup(
            parentGroupId === MISSING_GROUP_ID ? null : parentGroupId,
            tree.treeId,
          );
        }
      }
    });
    // Update the store and state after removing
    this.props.onUpdateTreeGroups(newTreeGroups);
  };

  hideDeleteGroupsModal = () => {
    this.setState({ groupToDelete: null });
  };

  askUserForDeletingGroup = (id: number) => {
    this.setState({ groupToDelete: id });
  };

  handleDelete = () => {
    // if there exist selected trees, ask to remove them
    const { selectedTrees } = this.state;
    const numbOfSelectedTrees = selectedTrees.length;
    if (numbOfSelectedTrees > 0) {
      const deleteAllSelectedTrees = () => {
        this.props.onDeleteMultipleTrees(selectedTrees);
        this.setState({ selectedTrees: [] });
      };
      this.showModalConfimWarning(
        "Delete all selected trees?",
        messages["tracing.delete_mulitple_trees"]({
          countOfTrees: numbOfSelectedTrees,
        }),
        deleteAllSelectedTrees,
      );
    } else {
      // just delete the active tree
      this.props.onDeleteTree();
    }
    // if there is an active group, aks the user whether to delete it or not
    if (this.props.skeletonTracing) {
      const { activeGroupId } = this.props.skeletonTracing;
      if (activeGroupId !== null && activeGroupId !== undefined) {
        this.askUserForDeletingGroup(activeGroupId);
      }
    }
  };

  shuffleTreeColor = () => {
    if (!this.props.skeletonTracing) {
      return;
    }
    getActiveTree(this.props.skeletonTracing).map(activeTree =>
      this.props.onShuffleTreeColor(activeTree.treeId),
    );
  };

  shuffleAllTreeColors = () => {
    this.props.onShuffleAllTreeColors();
  };

  toggleAllTrees() {
    Store.dispatch(toggleAllTreesAction());
  }

  toggleInactiveTrees() {
    Store.dispatch(toggleInactiveTreesAction());
  }

  handleNmlDownload = async () => {
    const { skeletonTracing } = this.props;
    if (!skeletonTracing) {
      return;
    }
    await this.setState({ isDownloading: true });
    // Wait 1 second for the Modal to render
    const [buildInfo] = await Promise.all([getBuildInfo(), Utils.sleep(1000)]);
    const state = Store.getState();
    const nml = serializeToNml(state, this.props.annotation, skeletonTracing, buildInfo);
    this.setState({ isDownloading: false });

    const blob = new Blob([nml], { type: "text/plain;charset=utf-8" });
    saveAs(blob, getNmlName(state));
  };

  showModalConfimWarning(title: string, content: string, onConfirm: () => void) {
    Modal.confirm({
      title,
      content,
      okText: "Ok",
      cancelText: "No",
      autoFocusButton: "cancel",
      iconType: "warning",
      onCancel: () => {},
      onOk: () => {
        onConfirm();
      },
    });
  }

  handleTreeSelect = id => {
    if (!this.props.skeletonTracing) {
      return;
    }
    if (this.state.selectedTrees.includes(id)) {
      this.setState(prevState => ({
        selectedTrees: prevState.selectedTrees.filter(currentId => currentId !== id),
      }));
    } else {
      this.setState(prevState => ({
        selectedTrees: [...prevState.selectedTrees, id],
      }));
    }
  };

  getAllSubtreeIdsOfGroup = (idOfGroup: number): Array<number> => {
    if (!this.props.skeletonTracing) {
      return [];
    }
    const { trees } = this.props.skeletonTracing;
    const treeGroupMap = createGroupToTreesMap(trees);
    let subtreeIdsOfGroup = [];
    if (treeGroupMap[idOfGroup]) {
      subtreeIdsOfGroup = treeGroupMap[idOfGroup].map(node => node.treeId);
    }
    return subtreeIdsOfGroup;
  };

  getAllSubgroupIdsOfGroup = (idOfGroup: number, groupTree: ?TreeGroup): Array<number> => {
    let allSubGroupIds = [];
    if (groupTree) {
      allSubGroupIds = groupTree.children.map(subGroup => subGroup.groupId);
    }
    return allSubGroupIds;
  };

  deselectEverything = () => {
    this.setState({ selectedTrees: [] });
  };

  getTreesComponents() {
    if (!this.props.skeletonTracing) {
      return null;
    }
    const orderAttribute = this.props.userConfiguration.sortTreesByName ? "name" : "timestamp";

    return (
      <TreeHierarchyView
        trees={this.props.skeletonTracing.trees}
        treeGroups={this.props.skeletonTracing.treeGroups}
        activeTreeId={this.props.skeletonTracing.activeTreeId}
        activeGroupId={this.props.skeletonTracing.activeGroupId}
        sortBy={orderAttribute}
        selectedTrees={this.state.selectedTrees}
        handleTreeSelect={this.handleTreeSelect}
        onDeleteGroup={this.askUserForDeletingGroup}
      />
    );
  }

  handleDropdownClick = ({ key }) => {
    const shouldSortTreesByName = key === "sortByName";
    this.props.onSortTree(shouldSortTreesByName);
  };

  getSettingsDropdown() {
    const activeMenuKey = this.props.userConfiguration.sortTreesByName
      ? "sortByName"
      : "sortByTime";

    return (
      <Menu selectedKeys={[activeMenuKey]} onClick={this.handleDropdownClick}>
        <Menu.Item key="sortByName">by name</Menu.Item>
        <Menu.Item key="sortByTime">by creation time</Menu.Item>
      </Menu>
    );
  }

  getActionsDropdown() {
    return (
      <Menu>
        <Menu.Item key="shuffleTreeColor" onClick={this.shuffleTreeColor} title="Change Tree Color">
          <i className="fa fa-adjust" /> Change Color
        </Menu.Item>
        <Menu.Item
          key="shuffleAllTreeColors"
          onClick={this.shuffleAllTreeColors}
          title="Shuffle All Tree Colors"
        >
          <i className="fa fa-random" /> Shuffle All Colors
        </Menu.Item>
        <Menu.Item
          key="handleNmlDownload"
          onClick={this.handleNmlDownload}
          title="Download selected trees as NML"
        >
          <Icon type="download" /> Download Selected Trees
        </Menu.Item>
        <Menu.Item key="importNml" onClick={this.props.showDropzoneModal} title="Import NML files">
          <Icon type="upload" /> Import NML
        </Menu.Item>
      </Menu>
    );
  }

  render() {
    const { skeletonTracing } = this.props;
    if (!skeletonTracing) {
      return null;
    }
    const activeTreeName = getActiveTree(skeletonTracing)
      .map(activeTree => activeTree.name)
      .getOrElse("");
    const activeGroupName = getActiveGroup(skeletonTracing)
      .map(activeGroup => activeGroup.name)
      .getOrElse("");
    const selectionInfo = `${this.state.selectedTrees.length} tree(s) selected.`;

    // Avoid that the title switches to the other title during the fadeout of the Modal
    let title = "";
    if (this.state.isDownloading) {
      title = "Preparing NML";
    } else if (this.state.isUploading) {
      title = "Importing NML";
    }
    const { groupToDelete } = this.state;

    return (
      <div id="tree-list" className="info-tab-content">
        <Modal
          visible={this.state.isDownloading || this.state.isUploading}
          title={title}
          closable={false}
          footer={null}
          width={200}
          style={{ textAlign: "center" }}
        >
          <Spin />
        </Modal>
        <ButtonGroup>
          <SearchPopover
            onSelect={this.props.onSetActiveTree}
            data={skeletonTracing.trees}
            idKey="treeId"
            searchKey="name"
            maxSearchResults={10}
            provideShortcut
          >
            <Tooltip title="Open the search via CTRL + Shift + F">
              <ButtonComponent>
                <Icon type="search" />
              </ButtonComponent>
            </Tooltip>
          </SearchPopover>
          <ButtonComponent onClick={this.props.onCreateTree} title="Create Tree">
            <i className="fa fa-plus" /> Create
          </ButtonComponent>
          <ButtonComponent onClick={this.handleDelete} title="Delete Tree">
            <i className="fa fa-trash-o" /> Delete
          </ButtonComponent>
          <ButtonComponent onClick={this.toggleAllTrees} title="Toggle Visibility of All Trees">
            <i className="fa fa-toggle-on" /> Toggle All
          </ButtonComponent>
          <ButtonComponent
            onClick={this.toggleInactiveTrees}
            title="Toggle Visibility of Inactive Trees"
          >
            <i className="fa fa-toggle-off" /> Toggle Inactive
          </ButtonComponent>
          <Dropdown overlay={this.getActionsDropdown()}>
            <ButtonComponent>
              More<Icon type="down" />
            </ButtonComponent>
          </Dropdown>
        </ButtonGroup>
        <InputGroup compact>
          <ButtonComponent onClick={this.props.onSelectNextTreeBackward}>
            <i className="fa fa-arrow-left" />
          </ButtonComponent>
          <InputComponent
            onChange={this.handleChangeTreeName}
            value={activeTreeName || activeGroupName}
            style={{ width: "60%" }}
          />
          <ButtonComponent onClick={this.props.onSelectNextTreeForward}>
            <i className="fa fa-arrow-right" />
          </ButtonComponent>
          <Dropdown overlay={this.getSettingsDropdown()}>
            <ButtonComponent title="Sort">
              <i className="fa fa-sort-alpha-asc" />
            </ButtonComponent>
          </Dropdown>
        </InputGroup>
        <div className="tree-hierarchy-header">
          <span>{selectionInfo}</span>
          <br />
          <span className="clickable-text" onClick={this.deselectEverything}>
            Click here to unselect everything
          </span>
        </div>
        <ul style={{ flex: "1 1 auto", overflow: "auto", margin: 0, padding: 0 }}>
          {this.getTreesComponents()}
        </ul>
        {groupToDelete !== null ? (
          <DeleteGroupModalView
            onCancel={this.hideDeleteGroupsModal}
            onJustDeleteGroup={() => {
              this.hideDeleteGroupsModal();
              if (groupToDelete !== null && groupToDelete !== undefined) {
                this.deleteGroup(groupToDelete, false);
              }
            }}
            onDeleteGroupAndTrees={() => {
              this.hideDeleteGroupsModal();
              if (groupToDelete !== null && groupToDelete !== undefined) {
                this.deleteGroup(groupToDelete, true);
              }
            }}
          />
        ) : null}
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  annotation: state.tracing,
  skeletonTracing: state.tracing.skeleton,
  userConfiguration: state.userConfiguration,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onShuffleTreeColor(treeId) {
    dispatch(shuffleTreeColorAction(treeId));
  },
  onShuffleAllTreeColors() {
    dispatch(shuffleAllTreeColorsAction());
  },
  onSortTree(shouldSortTreesByName) {
    dispatch(updateUserSettingAction("sortTreesByName", shouldSortTreesByName));
  },
  onSelectNextTreeForward() {
    dispatch(selectNextTreeAction(true));
  },
  onSelectNextTreeBackward() {
    dispatch(selectNextTreeAction(false));
  },
  onCreateTree() {
    dispatch(createTreeAction());
  },
  onDeleteTree() {
    dispatch(deleteTreeAsUserAction());
  },
  onDeleteMultipleTrees(ids) {
    dispatch(deleteMultipleTreesAsUserAction(ids));
  },
  onSetTreeGroup(groupId, treeId) {
    dispatch(setTreeGroupAction(groupId, treeId));
  },
  onUpdateTreeGroups(treeGroups) {
    dispatch(setTreeGroupsAction(treeGroups));
  },
  onChangeTreeName(name) {
    dispatch(setTreeNameAction(name));
  },
  onSetActiveTree(treeId) {
    dispatch(setActiveTreeAction(treeId));
  },
  showDropzoneModal() {
    dispatch(setDropzoneModalVisibilityAction(true));
  },
});

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(TreesTabView);
