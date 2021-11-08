// @flow
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  Menu,
  Spin,
  Modal,
  Tooltip,
  notification,
} from "antd";
import {
  DownloadOutlined,
  DownOutlined,
  SearchOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { batchActions } from "redux-batched-actions";
import { saveAs } from "file-saver";
import * as React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import {
  createGroupToTreesMap,
  callDeep,
  MISSING_GROUP_ID,
} from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import Model from "oxalis/model";
import {
  getActiveTree,
  getActiveGroup,
  getTree,
  enforceSkeletonTracing,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import { getBuildInfo, importVolumeTracing, clearCache } from "admin/admin_rest_api";
import { readFileAsText, readFileAsArrayBuffer } from "libs/read_file";
import {
  serializeToNml,
  getNmlName,
  parseNml,
  wrapInNewGroup,
  NmlParseError,
} from "oxalis/model/helpers/nml_helpers";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import { createMutableTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  setTreeNameAction,
  createTreeAction,
  deleteTreeAction,
  deleteTreeAsUserAction,
  shuffleAllTreeColorsAction,
  selectNextTreeAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
  setActiveTreeAction,
  deselectActiveTreeAction,
  deselectActiveGroupAction,
  setActiveGroupAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  addTreesAndGroupsAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  importVolumeTracingAction,
  setMaxCellAction,
  performMinCutAction,
} from "oxalis/model/actions/volumetracing_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { addUserBoundingBoxesAction } from "oxalis/model/actions/annotation_actions";
import { type Action } from "oxalis/model/actions/actions";
import { setVersionNumberAction } from "oxalis/model/actions/save_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import InputComponent from "oxalis/view/components/input_component";
import Store, {
  type OxalisState,
  type SkeletonTracing,
  type Tracing,
  type Tree,
  type TreeMap,
  type TreeGroup,
  type UserConfiguration,
} from "oxalis/store";
import Toast from "libs/toast";
import TreeHierarchyView from "oxalis/view/right-border-tabs/tree_hierarchy_view";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import messages from "messages";
import JSZip from "jszip";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";

import DeleteGroupModalView from "./delete_group_modal_view";
import AdvancedSearchPopover from "./advanced_search_popover";

const InputGroup = Input.Group;

const treeTabId = "tree-list";

type TreeOrTreeGroup = {
  name: string,
  id: number,
  type: string,
};

type StateProps = {|
  onShuffleAllTreeColors: () => void,
  onSortTree: boolean => void,
  onSelectNextTreeForward: () => void,
  onSelectNextTreeBackward: () => void,
  onCreateTree: () => void,
  onMinCut: () => void,
  onDeleteTree: () => void,
  onSetTreeGroup: (?number, number) => void,
  onChangeTreeName: string => void,
  onBatchActions: (Array<Action>, string) => void,
  annotation: Tracing,
  skeletonTracing: ?SkeletonTracing,
  userConfiguration: UserConfiguration,
  onSetActiveTree: number => void,
  onDeselectActiveTree: () => void,
  onSetActiveGroup: number => void,
  onDeselectActiveGroup: () => void,
  showDropzoneModal: () => void,
  allowUpdate: boolean,
|};
type Props = {| ...StateProps |};

type State = {
  isUploading: boolean,
  isDownloading: boolean,
  selectedTrees: Array<number>,
  groupToDelete: ?number,
};

export async function importTracingFiles(files: Array<File>, createGroupForEachFile: boolean) {
  try {
    const wrappedAddTreesAndGroupsAction = (trees, treeGroups, groupName, userBoundingBoxes) => {
      const actions =
        userBoundingBoxes && userBoundingBoxes.length > 0
          ? [addUserBoundingBoxesAction(userBoundingBoxes)]
          : [];
      if (createGroupForEachFile) {
        const [wrappedTrees, wrappedTreeGroups] = wrapInNewGroup(trees, treeGroups, groupName);
        return [...actions, addTreesAndGroupsAction(wrappedTrees, wrappedTreeGroups)];
      } else {
        return [...actions, addTreesAndGroupsAction(trees, treeGroups)];
      }
    };

    const tryParsingFileAsNml = async file => {
      try {
        const nmlString = await readFileAsText(file);
        const { trees, treeGroups, userBoundingBoxes, datasetName } = await parseNml(nmlString);

        return {
          importActions: wrappedAddTreesAndGroupsAction(
            trees,
            treeGroups,
            file.name,
            userBoundingBoxes,
          ),
          datasetName,
        };
      } catch (error) {
        if (error instanceof NmlParseError) {
          // NmlParseError means the file we're dealing with is an NML-like file, but there was
          // an error during the validation.
          // In that case we want to show the validation error instead of the generic one.
          throw error;
        }
        console.error(`Tried parsing file "${file.name}" as NML but failed. ${error.message}`);
        return undefined;
      }
    };

    const tryParsingFileAsProtobuf = async file => {
      try {
        const nmlProtoBuffer = await readFileAsArrayBuffer(file);
        const parsedTracing = parseProtoTracing(nmlProtoBuffer, "skeleton");

        if (!parsedTracing.trees) {
          // This check is only for flow to realize that we have a skeleton tracing
          // on our hands.
          throw new Error("Skeleton tracing doesn't contain trees");
        }

        return {
          importActions: wrappedAddTreesAndGroupsAction(
            createMutableTreeMapFromTreeArray(parsedTracing.trees),
            parsedTracing.treeGroups,
            file.name,
          ),
          datasetName: parsedTracing.dataSetName,
        };
      } catch (error) {
        console.error(`Tried parsing file "${file.name}" as protobuf but failed. ${error.message}`);
        return undefined;
      }
    };

    const tryParsingFileAsZip = async file => {
      try {
        const zipFile = await JSZip().loadAsync(readFileAsArrayBuffer(file));
        const nmlFileName = Object.keys(zipFile.files).find(key =>
          Utils.isFileExtensionEqualTo(key, "nml"),
        );
        const nmlFile = await zipFile.file(nmlFileName).async("blob");
        const nmlImportActions = await tryParsingFileAsNml(nmlFile);

        const dataFileName = Object.keys(zipFile.files).find(key =>
          Utils.isFileExtensionEqualTo(key, "zip"),
        );
        if (dataFileName) {
          const dataBlob = await zipFile.file(dataFileName).async("blob");
          const dataFile = new File([dataBlob], dataFileName);

          await Model.ensureSavedState();
          const { tracing, dataset } = Store.getState();
          const oldVolumeTracing = tracing.volume;

          const newLargestSegmentId = await importVolumeTracing(tracing, dataFile);

          if (oldVolumeTracing) {
            Store.dispatch(importVolumeTracingAction());
            Store.dispatch(setVersionNumberAction(oldVolumeTracing.version + 1, "volume"));
            Store.dispatch(setMaxCellAction(newLargestSegmentId));
            await clearCache(dataset, oldVolumeTracing.tracingId);
            await api.data.reloadBuckets(oldVolumeTracing.tracingId);
            window.needsRerender = true;
          }
        }

        return nmlImportActions;
      } catch (error) {
        console.error(`Tried parsing file "${file.name}" as ZIP but failed. ${error.message}`);
        return undefined;
      }
    };

    const { successes: importActionsWithDatasetNames, errors } = await Utils.promiseAllWithErrors(
      files.map(async file => {
        const ext = _.last(file.name.split(".")).toLowerCase();
        let tryImportFunctions;
        if (ext === "nml" || ext === "xml")
          tryImportFunctions = [tryParsingFileAsNml, tryParsingFileAsProtobuf];
        else if (ext === "zip") tryImportFunctions = [tryParsingFileAsZip];
        else tryImportFunctions = [tryParsingFileAsProtobuf, tryParsingFileAsNml];
        /* eslint-disable no-await-in-loop */
        for (const importFunction of tryImportFunctions) {
          const maybeImportAction = await importFunction(file);
          if (maybeImportAction) {
            return maybeImportAction;
          }
        }
        /* eslint-enable no-await-in-loop */
        throw new Error(`"${file.name}" could not be parsed as NML, protobuf or ZIP.`);
      }),
    );

    if (errors.length > 0) {
      throw errors;
    }

    // Dispatch the actual actions as the very last step, so that
    // not a single store mutation happens if something above throws
    // an error
    importActionsWithDatasetNames
      .flatMap(el => el.importActions)
      .forEach(action => Store.dispatch(action));
  } catch (e) {
    (Array.isArray(e) ? e : [e]).forEach(err => Toast.error(err.message));
  }
}

// Let the user confirm the deletion of the initial node (node with id 1) of a task
function checkAndConfirmDeletingInitialNode(treeIds) {
  const state = Store.getState();
  const skeletonTracing = enforceSkeletonTracing(state.tracing);
  const hasNodeWithIdOne = id => getTree(skeletonTracing, id).map(tree => tree.nodes.has(1));
  const needsCheck = state.task != null && treeIds.find(hasNodeWithIdOne) != null;

  return new Promise((resolve, reject) => {
    if (needsCheck) {
      Modal.confirm({
        title: messages["tracing.delete_tree_with_initial_node"],
        onOk: () => resolve(),
        onCancel: () => reject(),
      });
    } else {
      resolve();
    }
  });
}

class SkeletonTabView extends React.PureComponent<Props, State> {
  state = {
    isUploading: false,
    isDownloading: false,
    selectedTrees: [],
    groupToDelete: null,
  };

  getTreeAndTreeGroupList = memoizeOne(
    (trees: TreeMap, treeGroups: Array<TreeGroup>, sortBy: string): Array<TreeOrTreeGroup> => {
      const groupToTreesMap = createGroupToTreesMap(trees);
      const rootGroup = { name: "Root", groupId: MISSING_GROUP_ID, children: treeGroups };

      const makeTree = tree => ({ name: tree.name, type: "TREE", id: tree.treeId });
      const makeGroup = group => ({ name: group.name, type: "GROUP", id: group.groupId });

      function* mapGroupsAndTreesSorted(
        _groups: Array<TreeGroup>,
        _groupToTreesMap: { [number]: Array<Tree> },
        _sortBy: string,
      ): Generator<TreeOrTreeGroup, void, void> {
        for (const group of _groups) {
          yield makeGroup(group);
          if (group.children) {
            // Groups are always sorted by name and appear before the trees
            const sortedGroups = _.orderBy(group.children, ["name"], ["asc"]);
            yield* mapGroupsAndTreesSorted(sortedGroups, _groupToTreesMap, sortBy);
          }
          if (_groupToTreesMap[group.groupId] != null) {
            // Trees are sorted by the sortBy property
            const sortedTrees = _.orderBy(_groupToTreesMap[group.groupId], [_sortBy], ["asc"]);
            yield* sortedTrees.map(makeTree);
          }
        }
      }

      return Array.from(mapGroupsAndTreesSorted([rootGroup], groupToTreesMap, sortBy));
    },
  );

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

    let treeIdsToDelete = [];
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
      // Finds all subtrees of the passed group recursively
      const findSubtreesRecursively = group => {
        const currentSubtrees =
          groupToTreesMap[group.groupId] != null ? groupToTreesMap[group.groupId] : [];
        // Delete all trees of the current group
        treeIdsToDelete = treeIdsToDelete.concat(currentSubtrees.map(tree => tree.treeId));
        // Also delete the trees of all subgroups
        group.children.forEach(subgroup => findSubtreesRecursively(subgroup));
      };
      findSubtreesRecursively(item);
    });

    checkAndConfirmDeletingInitialNode(treeIdsToDelete).then(() => {
      // Update the store at once
      const deleteTreeActions = treeIdsToDelete.map(treeId => deleteTreeAction(treeId));
      this.props.onBatchActions(
        deleteTreeActions.concat(setTreeGroupsAction(newTreeGroups)),
        "DELETE_GROUP_AND_TREES",
      );
    });
  };

  hideDeleteGroupsModal = () => {
    this.setState({ groupToDelete: null });
  };

  showDeleteGroupModal = (id: number) => {
    if (!this.props.skeletonTracing) return;

    const { trees, treeGroups } = this.props.skeletonTracing;
    const treeGroupToDelete = treeGroups.find(el => el.groupId === id);
    const groupToTreesMap = createGroupToTreesMap(trees);

    if (treeGroupToDelete && treeGroupToDelete.children.length === 0 && !groupToTreesMap[id])
      this.deleteGroup(id);
    else this.setState({ groupToDelete: id });
  };

  handleDelete = () => {
    // If there exist selected trees, ask to remove them
    const { selectedTrees } = this.state;
    const numbOfSelectedTrees = selectedTrees.length;
    if (numbOfSelectedTrees > 0) {
      const deleteAllSelectedTrees = () => {
        checkAndConfirmDeletingInitialNode(selectedTrees).then(() => {
          const deleteTreeActions = selectedTrees.map(treeId => deleteTreeAction(treeId));
          this.props.onBatchActions(deleteTreeActions, "DELETE_TREE");
          this.setState({ selectedTrees: [] });
        });
      };
      this.showModalConfirmWarning(
        "Delete all selected trees?",
        messages["tracing.delete_multiple_trees"]({
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

  showModalConfirmWarning(title: string, content: string, onConfirm: () => void) {
    Modal.confirm({
      title,
      content,
      okText: "Ok",
      cancelText: "No",
      autoFocusButton: "cancel",
      icon: <WarningOutlined />,
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
      // If the tree is the second last -> set remaining tree to be the active tree
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

  deselectAllTrees = () => {
    this.setState({ selectedTrees: [] });
  };

  handleSearchSelect = (selectedElement: TreeOrTreeGroup) => {
    if (selectedElement.type === "TREE") {
      this.props.onSetActiveTree(selectedElement.id);
    } else {
      this.props.onSetActiveGroup(selectedElement.id);
    }
  };

  getTreesComponents(sortBy: string) {
    if (!this.props.skeletonTracing) {
      return null;
    }

    return (
      <TreeHierarchyView
        trees={this.props.skeletonTracing.trees}
        treeGroups={this.props.skeletonTracing.treeGroups}
        activeTreeId={this.props.skeletonTracing.activeTreeId}
        activeGroupId={this.props.skeletonTracing.activeGroupId}
        allowUpdate={this.props.allowUpdate}
        sortBy={sortBy}
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
        <Menu.Item
          key="shuffleAllTreeColors"
          onClick={this.shuffleAllTreeColors}
          title="Shuffle All Tree Colors"
        >
          <i className="fas fa-random" /> Shuffle All Tree Colors
        </Menu.Item>
        <Menu.Item
          key="handleNmlDownload"
          onClick={this.handleNmlDownload}
          title="Download selected trees as NML"
        >
          <DownloadOutlined /> Download Selected Trees
        </Menu.Item>
        <Menu.Item key="importNml" onClick={this.props.showDropzoneModal} title="Import NML files">
          <UploadOutlined /> Import NML
        </Menu.Item>
        <Menu.Item
          key="measureAllSkeletons"
          onClick={this.handleMeasureAllSkeletonsLength}
          title="Measure Length of All Skeletons"
        >
          <i className="fas fa-ruler" /> Measure Length of All Skeletons
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

  handleMeasureAllSkeletonsLength = () => {
    const [totalLengthNm, totalLengthVx] = api.tracing.measureAllTrees();

    notification.open({
      message: `The total length of all skeletons is ${formatNumberToLength(
        totalLengthNm,
      )} (${formatLengthAsVx(totalLengthVx)}).`,
      icon: <i className="fas fa-ruler" />,
    });
  };

  render() {
    const { skeletonTracing } = this.props;
    if (!skeletonTracing) {
      return null;
    }
    const { showSkeletons } = skeletonTracing;
    const activeTreeName = getActiveTree(skeletonTracing)
      .map(activeTree => activeTree.name)
      .getOrElse("");
    const activeGroupName = getActiveGroup(skeletonTracing)
      .map(activeGroup => activeGroup.name)
      .getOrElse("");
    const { trees, treeGroups } = skeletonTracing;
    const noTreesAndGroups = _.size(trees) === 0 && _.size(treeGroups) === 0;
    const orderAttribute = this.props.userConfiguration.sortTreesByName ? "name" : "timestamp";

    // Avoid that the title switches to the other title during the fadeout of the Modal
    let title = "";
    if (this.state.isDownloading) {
      title = "Preparing NML";
    } else if (this.state.isUploading) {
      title = "Importing NML";
    }
    const { groupToDelete } = this.state;

    return (
      <div id={treeTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={treeTabId}>
          {isVisibleInDom =>
            !isVisibleInDom ? null : (
              <React.Fragment>
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
                <InputGroup compact className="compact-icons">
                  <AdvancedSearchPopover
                    onSelect={this.handleSearchSelect}
                    data={this.getTreeAndTreeGroupList(trees, treeGroups, orderAttribute)}
                    searchKey="name"
                    provideShortcut
                    targetId={treeTabId}
                  >
                    <ButtonComponent title="Open the search via CTRL + Shift + F">
                      <SearchOutlined />
                    </ButtonComponent>
                  </AdvancedSearchPopover>
                  <ButtonComponent onClick={this.props.onMinCut} title="Min-Cut">
                    <i className="fas fa-cut" />
                  </ButtonComponent>
                  <ButtonComponent
                    onClick={this.props.onCreateTree}
                    title="Create new Tree (C)"
                    disabled={!this.props.allowUpdate}
                  >
                    <i className="fas fa-plus" />
                  </ButtonComponent>
                  <ButtonComponent
                    onClick={this.handleDelete}
                    title="Delete Selected Trees"
                    disabled={!this.props.allowUpdate}
                  >
                    <i className="far fa-trash-alt" />
                  </ButtonComponent>
                  <ButtonComponent
                    onClick={this.toggleAllTrees}
                    title="Toggle Visibility of All Trees (1)"
                  >
                    <i className="fas fa-toggle-on" />
                  </ButtonComponent>
                  <ButtonComponent
                    onClick={this.toggleInactiveTrees}
                    title="Toggle Visibility of Inactive Trees (2)"
                  >
                    <i className="fas fa-toggle-off" />
                  </ButtonComponent>
                  <Dropdown overlay={this.getActionsDropdown()} trigger={["click"]}>
                    <ButtonComponent>
                      More
                      <DownOutlined />
                    </ButtonComponent>
                  </Dropdown>
                </InputGroup>
                <InputGroup compact className="compact-icons compact-items">
                  <ButtonComponent onClick={this.props.onSelectNextTreeBackward}>
                    <i className="fas fa-arrow-left" />
                  </ButtonComponent>
                  <InputComponent
                    onChange={this.handleChangeTreeName}
                    value={activeTreeName || activeGroupName}
                    disabled={noTreesAndGroups}
                    style={{ width: "70%" }}
                  />
                  <ButtonComponent onClick={this.props.onSelectNextTreeForward}>
                    <i className="fas fa-arrow-right" />
                  </ButtonComponent>
                  <Dropdown overlay={this.getSettingsDropdown()} trigger={["click"]}>
                    <ButtonComponent title="Sort">
                      <i className="fas fa-sort-alpha-down" />
                    </ButtonComponent>
                  </Dropdown>
                </InputGroup>
                {!showSkeletons ? (
                  <Tooltip title={messages["tracing.skeletons_are_hidden_warning"]}>
                    <WarningOutlined style={{ color: "var(--ant-warning)" }} />
                  </Tooltip>
                ) : null}
                {noTreesAndGroups ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <span>
                        There are no trees in this tracing.
                        <br /> A new tree will be created automatically once a node is set.
                      </span>
                    }
                  />
                ) : (
                  <ul style={{ flex: "1 1 auto", overflow: "auto", margin: 0, padding: 0 }}>
                    <div className="tree-hierarchy-header">{this.getSelectedTreesAlert()}</div>
                    {this.getTreesComponents(orderAttribute)}
                  </ul>
                )}
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
              </React.Fragment>
            )
          }
        </DomVisibilityObserver>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  annotation: state.tracing,
  allowUpdate: state.tracing.restrictions.allowUpdate,
  skeletonTracing: state.tracing.skeleton,
  userConfiguration: state.userConfiguration,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
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
  onMinCut() {
    dispatch(performMinCutAction());
  },
  onDeleteTree() {
    dispatch(deleteTreeAsUserAction());
  },
  onBatchActions(actions, actionName) {
    dispatch(batchActions(actions, actionName));
  },
  onSetTreeGroup(groupId, treeId) {
    dispatch(setTreeGroupAction(groupId, treeId));
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
  onSetActiveGroup(groupId) {
    dispatch(setActiveGroupAction(groupId));
  },
  onDeselectActiveGroup() {
    dispatch(deselectActiveGroupAction());
  },
  showDropzoneModal() {
    dispatch(setDropzoneModalVisibilityAction(true));
  },
});

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(SkeletonTabView);
