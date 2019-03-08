/**
 * list_tree_view.js
 * @flow
 */
import { Alert, Button, Dropdown, Input, Menu, Icon, Spin, Modal, Tooltip } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { saveAs } from "file-saver";
import * as React from "react";
import _ from "lodash";

import { binaryConfirm } from "libs/async_confirm";
import {
  createGroupToTreesMap,
  callDeep,
  MISSING_GROUP_ID,
} from "oxalis/view/right-menu/tree_hierarchy_view_helpers";
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
  deselectActiveTreeAction,
  deselectActiveGroupAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  addTreesAndGroupsAction,
} from "oxalis/model/actions/skeletontracing_actions";
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
import messages from "messages";

import DeleteGroupModalView from "./delete_group_modal_view";
import SearchPopover from "./search_popover";
import AdvancedSearchPopover from "./advanced_search_popover";

const ButtonGroup = Button.Group;
const InputGroup = Input.Group;

type OwnProps = {|
  portalKey: string,
|};
type StateProps = {|
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
  skeletonTracing: ?SkeletonTracing,
  userConfiguration: UserConfiguration,
  onSetActiveTree: number => void,
  onDeselectActiveTree: () => void,
  onDeselectActiveGroup: () => void,
  showDropzoneModal: () => void,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  isUploading: boolean,
  isDownloading: boolean,
  selectedTrees: Array<number>,
  groupToDelete: ?number,
};

export async function importNmls(files: Array<File>, createGroupForEachFile: boolean) {
  try {
    const { successes: importActionsWithDatasetNames, errors } = await Utils.promiseAllWithErrors(
      files.map(async file => {
        const nmlString = await readFileAsText(file);
        try {
          const { trees, treeGroups, datasetName } = await parseNml(
            nmlString,
            createGroupForEachFile ? file.name : null,
          );
          return {
            importAction: addTreesAndGroupsAction(trees, treeGroups),
            datasetName,
          };
        } catch (e) {
          throw new Error(`"${file.name}" could not be parsed. ${e.message}`);
        }
      }),
    );

    if (errors.length > 0) {
      throw errors;
    }

    const currentDatasetName = Store.getState().dataset.name;
    const doDatasetNamesDiffer = importActionsWithDatasetNames
      .map(el => el.datasetName)
      .some(name => name !== "" && name != null && name !== currentDatasetName);
    if (doDatasetNamesDiffer) {
      const shouldImport = await binaryConfirm("Are you sure?", messages["nml.different_dataset"]);
      if (!shouldImport) {
        return;
      }
    }

    // Dispatch the actual actions as the very last step, so that
    // not a single store mutation happens if something above throws
    // an error
    importActionsWithDatasetNames
      .map(el => el.importAction)
      .forEach(action => Store.dispatch(action));
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

  handleChangeTreeName = (evt: SyntheticInputEvent<>) => {
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

  deleteGroup = (groupId: number, deleteRecursively: boolean = false) => {
    if (!this.props.skeletonTracing) {
      return;
    }
    const { treeGroups, trees } = this.props.skeletonTracing;
    const newTreeGroups = _.cloneDeep(treeGroups);
    const groupToTreesMap = createGroupToTreesMap(trees);
    callDeep(newTreeGroups, groupId, (item, index, parentsChildren, parentGroupId) => {
      const subtrees = groupToTreesMap[groupId] != null ? groupToTreesMap[groupId] : [];
      // Remove group
      parentsChildren.splice(index, 1);
      if (!deleteRecursively) {
        // Move all subgroups to the parent group
        parentsChildren.push(...item.children);
        // Update all subtrees
        for (const tree of subtrees) {
          this.props.onSetTreeGroup(
            parentGroupId === MISSING_GROUP_ID ? null : parentGroupId,
            tree.treeId,
          );
        }
        return;
      }
      // Removes all subtrees of the passed group recursively
      const deleteGroupsRecursively = group => {
        const currentSubtrees =
          groupToTreesMap[group.groupId] != null ? groupToTreesMap[group.groupId] : [];
        // Delete all trees of the current group
        this.props.onDeleteMultipleTrees(currentSubtrees.map(tree => tree.treeId));
        // Also delete the trees of all subgroups
        group.children.forEach(subgroup => deleteGroupsRecursively(subgroup));
      };
      deleteGroupsRecursively(item);
    });

    // Update the store and state after removing
    this.props.onUpdateTreeGroups(newTreeGroups);
  };

  hideDeleteGroupsModal = () => {
    this.setState({ groupToDelete: null });
  };

  showDeleteGroupModal = (id: number) => {
    this.setState({ groupToDelete: id });
  };

  handleDelete = () => {
    // If there exist selected trees, ask to remove them
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
      // Just delete the active tree
      this.props.onDeleteTree();
    }
    // If there is an active group, ask the user whether to delete it or not
    if (this.props.skeletonTracing) {
      const { activeGroupId } = this.props.skeletonTracing;
      if (activeGroupId != null) {
        this.showDeleteGroupModal(activeGroupId);
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

  onSelectTree = (id: number) => {
    const tracing = this.props.skeletonTracing;
    if (!tracing) {
      return;
    }
    const { selectedTrees } = this.state;
    // If the tree was already selected
    if (selectedTrees.includes(id)) {
      // If the tree is the second last -> set remaining tree to be the atcive tree
      if (selectedTrees.length === 2) {
        const lastSelectedTree = selectedTrees.find(treeId => treeId !== id);
        if (lastSelectedTree != null) {
          this.props.onSetActiveTree(lastSelectedTree);
        }
        this.deselectAllTrees();
      } else {
        // Just deselect the tree
        this.setState(prevState => ({
          selectedTrees: prevState.selectedTrees.filter(currentId => currentId !== id),
        }));
      }
    } else {
      const { activeTreeId } = tracing;
      if (selectedTrees.length === 0) {
        this.props.onDeselectActiveGroup();
        /* If there are no selected trees and no active tree:
           Set selected tree to the active tree */
        if (activeTreeId == null) {
          this.props.onSetActiveTree(id);
          return;
        }
      }
      // If the active node is selected, don't go into multi selection mode
      if (activeTreeId === id) {
        return;
      }
      if (selectedTrees.length === 0 && activeTreeId != null) {
        // If this is the first selected tree -> also select the active tree
        this.setState({
          selectedTrees: [id, activeTreeId],
        });
        // Remove the current active tree
        this.props.onDeselectActiveTree();
      } else {
        // Just select this tree
        this.setState(prevState => ({
          selectedTrees: [...prevState.selectedTrees, id],
        }));
      }
    }
  };

  getAllSubtreeIdsOfGroup = (groupId: number): Array<number> => {
    if (!this.props.skeletonTracing) {
      return [];
    }
    const { trees } = this.props.skeletonTracing;
    const groupToTreesMap = createGroupToTreesMap(trees);
    let subtreeIdsOfGroup = [];
    if (groupToTreesMap[groupId]) {
      subtreeIdsOfGroup = groupToTreesMap[groupId].map(node => node.treeId);
    }
    return subtreeIdsOfGroup;
  };

  deselectAllTrees = () => {
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
        onSelectTree={this.onSelectTree}
        deselectAllTrees={this.deselectAllTrees}
        onDeleteGroup={this.showDeleteGroupModal}
      />
    );
  }

  handleDropdownClick = ({ key }: { key: string }) => {
    const shouldSortTreesByName = key === "sortByName";
    this.props.onSortTree(shouldSortTreesByName);
  };

  deleteGroupAndHideModal(groupToDelete: ?number, deleteSubtrees: boolean = false) {
    this.hideDeleteGroupsModal();
    if (groupToDelete != null) {
      this.deleteGroup(groupToDelete, deleteSubtrees);
    }
  }

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

  getSelectedTreesAlert = () =>
    this.state.selectedTrees.length > 0 ? (
      <Alert
        type="info"
        message={
          <React.Fragment>
            {this.state.selectedTrees.length} Tree(s) selected.{" "}
            <Button type="dashed" size="small" onClick={this.deselectAllTrees}>
              Clear Selection
            </Button>
          </React.Fragment>
        }
      />
    ) : null;

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

    // Avoid that the title switches to the other title during the fadeout of the Modal
    let title = "";
    if (this.state.isDownloading) {
      title = "Preparing NML";
    } else if (this.state.isUploading) {
      title = "Importing NML";
    }
    const { groupToDelete } = this.state;

    return (
      <div id="tree-list" className="padded-tab-content">
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
          <AdvancedSearchPopover
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
          </AdvancedSearchPopover>
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
              More
              <Icon type="down" />
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
        <ul style={{ flex: "1 1 auto", overflow: "auto", margin: 0, padding: 0 }}>
          <div className="tree-hierarchy-header">{this.getSelectedTreesAlert()}</div>
          {this.getTreesComponents()}
        </ul>
        {groupToDelete !== null ? (
          <DeleteGroupModalView
            onCancel={this.hideDeleteGroupsModal}
            onJustDeleteGroup={() => {
              this.deleteGroupAndHideModal(groupToDelete, false);
            }}
            onDeleteGroupAndTrees={() => {
              this.deleteGroupAndHideModal(groupToDelete, true);
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
  onDeleteMultipleTrees(treeIds) {
    dispatch(deleteMultipleTreesAsUserAction(treeIds));
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
  onDeselectActiveTree() {
    dispatch(deselectActiveTreeAction());
  },
  onDeselectActiveGroup() {
    dispatch(deselectActiveGroupAction());
  },
  showDropzoneModal() {
    dispatch(setDropzoneModalVisibilityAction(true));
  },
});

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(TreesTabView);
