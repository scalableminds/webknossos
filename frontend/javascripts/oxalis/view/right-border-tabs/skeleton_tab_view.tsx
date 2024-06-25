import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Spin,
  Modal,
  Tooltip,
  notification,
  MenuProps,
  Space,
} from "antd";
import type { Dispatch } from "redux";
import {
  DownloadOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { batchActions } from "redux-batched-actions";
import { connect } from "react-redux";
import { saveAs } from "file-saver";
import { BlobReader, BlobWriter, ZipReader, Entry } from "@zip.js/zip.js";
import * as React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { Action } from "oxalis/model/actions/actions";
import { addUserBoundingBoxesAction } from "oxalis/model/actions/annotation_actions";
import {
  createGroupToTreesMap,
  callDeep,
  MISSING_GROUP_ID,
} from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import { createMutableTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";
import { getActiveSegmentationTracing } from "oxalis/model/accessors/volumetracing_accessor";
import {
  getActiveTree,
  getActiveTreeGroup,
  getTree,
  enforceSkeletonTracing,
  isSkeletonLayerTransformed,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getBuildInfo, importVolumeTracing, clearCache } from "admin/admin_rest_api";
import {
  importVolumeTracingAction,
  setLargestSegmentIdAction,
} from "oxalis/model/actions/volumetracing_actions";
import { parseProtoTracing } from "oxalis/model/helpers/proto_helpers";
import { readFileAsText, readFileAsArrayBuffer } from "libs/read_file";
import {
  serializeToNml,
  getNmlName,
  parseNml,
  wrapInNewGroup,
  NmlParseError,
} from "oxalis/model/helpers/nml_helpers";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
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
  deselectActiveTreeGroupAction,
  setActiveTreeGroupAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  addTreesAndGroupsAction,
  BatchableUpdateTreeAction,
  batchUpdateGroupsAndTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { setVersionNumberAction } from "oxalis/model/actions/save_actions";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import InputComponent from "oxalis/view/components/input_component";
import { Model } from "oxalis/singletons";
import type {
  OxalisState,
  Tree,
  TreeMap,
  TreeGroup,
  MutableTreeMap,
  UserBoundingBox,
} from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import TreeHierarchyView from "oxalis/view/right-border-tabs/tree_hierarchy_view";
import * as Utils from "libs/utils";
import { api } from "oxalis/singletons";
import messages from "messages";
import AdvancedSearchPopover from "./advanced_search_popover";
import DeleteGroupModalView from "./delete_group_modal_view";
import { isAnnotationOwner } from "oxalis/model/accessors/annotation_accessor";

const { confirm } = Modal;
const treeTabId = "tree-list";

type TreeOrTreeGroup = {
  name: string;
  id: number;
  type: string;
};
type StateProps = ReturnType<typeof mapStateToProps>;
type DispatchProps = ReturnType<typeof mapDispatchToProps>;
type Props = DispatchProps & StateProps;
type State = {
  isUploading: boolean;
  isDownloading: boolean;
  selectedTrees: Array<number>;
  groupToDelete: number | null | undefined;
};
export async function importTracingFiles(files: Array<File>, createGroupForEachFile: boolean) {
  try {
    const wrappedAddTreesAndGroupsAction = (
      trees: MutableTreeMap,
      treeGroups: TreeGroup[],
      groupName: string,
      userBoundingBoxes?: UserBoundingBox[],
    ) => {
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

    const tryParsingFileAsNml = async (file: File) => {
      try {
        const nmlString = await readFileAsText(file);
        const { trees, treeGroups, userBoundingBoxes, datasetName, containedVolumes } =
          await parseNml(nmlString);
        if (containedVolumes) {
          Toast.warning(
            "The NML file contained volume information which was ignored. Please upload the NML into the dashboard to create a new annotation which also contains the volume data.",
          );
        }
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

        // @ts-ignore
        console.error(`Tried parsing file "${file.name}" as NML but failed. ${error.message}`);
        return undefined;
      }
    };

    const tryParsingFileAsProtobuf = async (file: File) => {
      try {
        const nmlProtoBuffer = await readFileAsArrayBuffer(file);
        const parsedTracing = parseProtoTracing(nmlProtoBuffer, "skeleton");

        if (!("trees" in parsedTracing)) {
          // This check is only for TS to realize that we have a skeleton tracing
          // on our hands.
          throw new Error("Skeleton tracing doesn't contain trees");
        }

        return {
          importActions: wrappedAddTreesAndGroupsAction(
            createMutableTreeMapFromTreeArray(parsedTracing.trees),
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'TreeGroup[] | null | undefined' ... Remove this comment to see the full error message
            parsedTracing.treeGroups,
            file.name,
          ),
        };
      } catch (error) {
        // @ts-ignore
        console.error(`Tried parsing file "${file.name}" as protobuf but failed. ${error.message}`);
        return undefined;
      }
    };

    const tryParsingFileAsZip = async (file: File) => {
      try {
        const reader = new ZipReader(new BlobReader(file));
        const entries = await reader.getEntries();
        const nmlFileEntry = entries.find((entry: Entry) =>
          Utils.isFileExtensionEqualTo(entry.filename, "nml"),
        );

        if (nmlFileEntry == null) {
          await reader.close();
          throw Error("Zip file doesn't contain an NML file.");
        }

        // The type definitions for getData are inaccurate. It is defined for entries obtained through calling ZipReader.getEntries, see https://github.com/gildas-lormeau/zip.js/issues/371#issuecomment-1272316813
        const nmlBlob = await nmlFileEntry.getData!(new BlobWriter());
        const nmlFile = new File([nmlBlob], nmlFileEntry.filename);

        const nmlImportActions = await tryParsingFileAsNml(nmlFile);

        const dataFileEntry = entries.find((entry: Entry) =>
          Utils.isFileExtensionEqualTo(entry.filename, "zip"),
        );

        if (dataFileEntry) {
          // The type definitions for getData are inaccurate. It is defined for entries obtained through calling ZipReader.getEntries, see https://github.com/gildas-lormeau/zip.js/issues/371#issuecomment-1272316813
          const dataBlob = await dataFileEntry.getData!(new BlobWriter());
          const dataFile = new File([dataBlob], dataFileEntry.filename);
          await Model.ensureSavedState();
          const storeState = Store.getState();
          const { tracing, dataset } = storeState;

          if (tracing.volumes.length === 0) {
            throw new Error("A volume tracing must already exist when importing a volume tracing.");
          }

          const oldVolumeTracing = getActiveSegmentationTracing(storeState);

          if (oldVolumeTracing == null) {
            throw new Error(
              "Ensure that a volume tracing layer is visible when importing a volume tracing.",
            );
          }

          const newLargestSegmentId = await importVolumeTracing(
            tracing,
            oldVolumeTracing,
            dataFile,
          );

          if (oldVolumeTracing) {
            Store.dispatch(importVolumeTracingAction());
            Store.dispatch(
              setVersionNumberAction(
                oldVolumeTracing.version + 1,
                "volume",
                oldVolumeTracing.tracingId,
              ),
            );
            Store.dispatch(setLargestSegmentIdAction(newLargestSegmentId));
            await clearCache(dataset, oldVolumeTracing.tracingId);
            await api.data.reloadBuckets(oldVolumeTracing.tracingId);
          }
        }

        await reader.close();
        return nmlImportActions;
      } catch (error) {
        // @ts-ignore
        console.error(`Tried parsing file "${file.name}" as ZIP but failed. ${error.message}`);
        return undefined;
      }
    };

    const { successes: importActionsWithDatasetNames, errors } = await Utils.promiseAllWithErrors(
      files.map(async (file) => {
        const ext = (_.last(file.name.split(".")) || "").toLowerCase();

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
      .flatMap((el) => el.importActions)
      .forEach((action) => Store.dispatch(action));
  } catch (e) {
    (Array.isArray(e) ? e : [e]).forEach((err) => Toast.error(err.message));
  }
}

// Let the user confirm the deletion of the initial node (node with id 1) of a task
function checkAndConfirmDeletingInitialNode(treeIds: number[]) {
  const state = Store.getState();
  const skeletonTracing = enforceSkeletonTracing(state.tracing);

  const hasNodeWithIdOne = (id: number) =>
    getTree(skeletonTracing, id).map((tree) => tree.nodes.has(1));

  const needsCheck = state.task != null && treeIds.find(hasNodeWithIdOne) != null;
  return new Promise<void>((resolve, reject) => {
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
  state: State = {
    isUploading: false,
    isDownloading: false,
    selectedTrees: [],
    groupToDelete: null,
  };

  getTreeAndTreeGroupList = memoizeOne(
    (trees: TreeMap, treeGroups: Array<TreeGroup>, sortBy: string): Array<TreeOrTreeGroup> => {
      const groupToTreesMap = createGroupToTreesMap(trees);
      const rootGroup = {
        name: "Root",
        groupId: MISSING_GROUP_ID,
        children: treeGroups,
      };

      const makeTree = (tree: Tree) => ({
        name: tree.name,
        type: "TREE",
        id: tree.treeId,
      });

      const makeGroup = (group: TreeGroup) => ({
        name: group.name,
        type: "GROUP",
        id: group.groupId,
      });

      function* mapGroupsAndTreesSorted(
        _groups: Array<TreeGroup>,
        _groupToTreesMap: Record<number, Array<Tree>>,
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

            // @ts-expect-error ts-migrate(2766) FIXME: Cannot delegate iteration to value because the 'ne... Remove this comment to see the full error message
            yield* sortedTrees.map(makeTree);
          }
        }
      }

      return Array.from(mapGroupsAndTreesSorted([rootGroup], groupToTreesMap, sortBy));
    },
  );

  handleChangeName = (evt: React.ChangeEvent<HTMLInputElement>) => {
    if (!this.props.skeletonTracing) {
      return;
    }

    const { activeGroupId } = this.props.skeletonTracing;

    if (activeGroupId != null) {
      api.tracing.renameSkeletonGroup(activeGroupId, evt.target.value);
    } else {
      this.props.onChangeTreeName(evt.target.value);
    }
  };

  deleteGroup = (groupId: number, deleteRecursively: boolean = false) => {
    if (!this.props.skeletonTracing) {
      return;
    }

    const { treeGroups, trees } = this.props.skeletonTracing;

    let newTreeGroups = _.cloneDeep(treeGroups);

    const groupToTreesMap = createGroupToTreesMap(trees);
    let treeIdsToDelete: number[] = [];

    if (groupId === MISSING_GROUP_ID) {
      // special case: delete Root group and all children (aka everything)
      treeIdsToDelete = Object.values(this.props.skeletonTracing.trees).map((t) => t.treeId);
      newTreeGroups = [];
    }

    const updateTreeActions: BatchableUpdateTreeAction[] = [];
    callDeep(newTreeGroups, groupId, (item, index, parentsChildren, parentGroupId) => {
      const subtrees = groupToTreesMap[groupId] != null ? groupToTreesMap[groupId] : [];
      // Remove group
      parentsChildren.splice(index, 1);

      if (!deleteRecursively) {
        // Move all subgroups to the parent group
        parentsChildren.push(...item.children);

        // Update all subtrees
        for (const tree of subtrees) {
          updateTreeActions.push(
            setTreeGroupAction(
              parentGroupId === MISSING_GROUP_ID ? null : parentGroupId,
              tree.treeId,
            ),
          );
        }

        return;
      }

      // Finds all subtrees of the passed group recursively
      const findChildrenRecursively = (group: TreeGroup) => {
        const currentSubtrees =
          groupToTreesMap[group.groupId] != null ? groupToTreesMap[group.groupId] : [];
        // Delete all trees of the current group
        treeIdsToDelete = treeIdsToDelete.concat(currentSubtrees.map((tree) => tree.treeId));
        // Also delete the trees of all subgroups
        group.children.forEach((subgroup) => findChildrenRecursively(subgroup));
      };

      findChildrenRecursively(item);
    });
    checkAndConfirmDeletingInitialNode(treeIdsToDelete).then(() => {
      // Update the store at once
      const deleteTreeActions: BatchableUpdateTreeAction[] = treeIdsToDelete.map((treeId) =>
        deleteTreeAction(treeId),
      );
      this.props.onBatchUpdateGroupsAndTreesAction(
        updateTreeActions.concat(deleteTreeActions, [setTreeGroupsAction(newTreeGroups)]),
      );
    });
  };

  hideDeleteGroupsModal = () => {
    this.setState({
      groupToDelete: null,
    });
  };

  showDeleteGroupModal = (id: number) => {
    if (!this.props.skeletonTracing) return;
    const { trees, treeGroups } = this.props.skeletonTracing;
    const treeGroupToDelete = treeGroups.find((el) => el.groupId === id);
    const groupToTreesMap = createGroupToTreesMap(trees);
    if (treeGroupToDelete && treeGroupToDelete.children.length === 0 && !groupToTreesMap[id]) {
      // Group is empty
      this.deleteGroup(id);
    } else if (id === MISSING_GROUP_ID) {
      // Ask whether all children of root group should be deleted
      // (doesn't need recursive/not-recursive distinction, since
      // the root group itself cannot be removed).
      confirm({
        title: "Do you want to delete all trees and groups?",
        icon: <ExclamationCircleOutlined />,
        okType: "danger",
        okText: "Delete",
        onOk: () => {
          this.deleteGroup(id);
        },
      });
    } else {
      // Show modal
      this.setState({
        groupToDelete: id,
      });
    }
  };

  handleDelete = () => {
    // If there exist selected trees, ask to remove them
    const { selectedTrees } = this.state;
    const numbOfSelectedTrees = selectedTrees.length;

    if (numbOfSelectedTrees > 0) {
      const deleteAllSelectedTrees = () => {
        checkAndConfirmDeletingInitialNode(selectedTrees).then(() => {
          const deleteTreeActions = selectedTrees.map((treeId) => deleteTreeAction(treeId));
          this.props.onBatchActions(deleteTreeActions, "DELETE_TREE");
          this.setState({
            selectedTrees: [],
          });
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

  handleNmlDownload = async (applyTransforms: boolean) => {
    const { skeletonTracing } = this.props;

    if (!skeletonTracing) {
      return;
    }

    this.setState({
      isDownloading: true,
    });
    // Wait 1 second for the Modal to render
    const [buildInfo] = await Promise.all([getBuildInfo(), Utils.sleep(1000)]);
    const state = Store.getState();
    const nml = serializeToNml(
      state,
      this.props.annotation,
      skeletonTracing,
      buildInfo,
      applyTransforms,
    );
    this.setState({
      isDownloading: false,
    });
    const blob = new Blob([nml], {
      type: "text/plain;charset=utf-8",
    });
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
        const lastSelectedTree = selectedTrees.find((treeId) => treeId !== id);

        if (lastSelectedTree != null) {
          this.props.onSetActiveTree(lastSelectedTree);
        }

        this.deselectAllTrees();
      } else {
        // Just deselect the tree
        this.setState((prevState) => ({
          selectedTrees: prevState.selectedTrees.filter((currentId) => currentId !== id),
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
        this.setState((prevState) => ({
          selectedTrees: [...prevState.selectedTrees, id],
        }));
      }
    }
  };

  deselectAllTrees = () => {
    this.setState({
      selectedTrees: [],
    });
  };

  handleSearchSelect = (selectedElement: TreeOrTreeGroup) => {
    if (selectedElement.type === "TREE") {
      this.props.onSetActiveTree(selectedElement.id);
    } else {
      this.props.onSetActiveTreeGroup(selectedElement.id);
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

  deleteGroupAndHideModal(
    groupToDelete: number | null | undefined,
    deleteSubtrees: boolean = false,
  ) {
    this.hideDeleteGroupsModal();

    if (groupToDelete != null) {
      this.deleteGroup(groupToDelete, deleteSubtrees);
    }
  }

  getSettingsDropdown(): MenuProps {
    const activeMenuKey = this.props.userConfiguration.sortTreesByName
      ? "sortByName"
      : "sortByTime";
    return {
      selectedKeys: [activeMenuKey],
      onClick: this.handleDropdownClick,
      items: [
        { key: "sortByName", label: "by name" },
        { key: "sortByTime", label: "by creation time" },
      ],
    };
  }

  getActionsDropdown(): MenuProps {
    const isEditingDisabled = !this.props.allowUpdate;
    return {
      items: [
        {
          key: "shuffleAllTreeColors",
          onClick: this.shuffleAllTreeColors,
          title: "Shuffle All Tree Colors",
          disabled: isEditingDisabled,
          icon: <i className="fas fa-random" />,
          label: "Shuffle All Tree Colors",
        },
        {
          key: "handleNmlDownload",
          onClick: () => this.handleNmlDownload(false),
          icon: <DownloadOutlined />,
          label: "Download Visible Trees",
          title: "Download Visible Trees as NML",
        },
        this.props.isSkeletonLayerTransformed
          ? {
              key: "handleNmlDownloadTransformed",
              onClick: () => this.handleNmlDownload(true),
              icon: <DownloadOutlined />,
              label: "Download Visible Trees (Transformed)",
              title: "The currently active transformation will be applied to each node.",
            }
          : null,
        {
          key: "importNml",
          onClick: this.props.showDropzoneModal,
          title: "Import NML files",
          disabled: isEditingDisabled,
          icon: <UploadOutlined />,
          label: "Import NML",
        },
        {
          key: "measureAllSkeletons",
          onClick: this.handleMeasureAllSkeletonsLength,
          title: "Measure Length of All Skeletons",

          icon: <i className="fas fa-ruler" />,
          label: "Measure Length of All Skeletons",
        },
      ],
    };
  }

  getSelectedTreesAlert = () =>
    this.state.selectedTrees.length > 0 ? (
      <Alert
        type="info"
        message={
          <React.Fragment>
            {this.state.selectedTrees.length}{" "}
            {Utils.pluralize("Tree", this.state.selectedTrees.length)} selected.{" "}
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
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            "This annotation does not contain a skeleton layer. You can add one in the Layers tab in the left sidebar."
          }
        />
      );
    }

    const { showSkeletons } = skeletonTracing;
    const activeTreeName = getActiveTree(skeletonTracing)
      .map((activeTree) => activeTree.name)
      .getOrElse("");
    const activeGroupName = getActiveTreeGroup(skeletonTracing)
      .map((activeGroup) => activeGroup.name)
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
    const isEditingDisabled = !this.props.allowUpdate;
    const { isAnnotationLockedByUser, isOwner } = this.props;
    const isEditingDisabledMessage = messages["tracing.read_only_mode_notification"](
      isAnnotationLockedByUser,
      isOwner,
    );

    return (
      <div id={treeTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={treeTabId}>
          {(isVisibleInDom) =>
            !isVisibleInDom ? null : (
              <React.Fragment>
                <Modal
                  open={this.state.isDownloading || this.state.isUploading}
                  title={title}
                  closable={false}
                  footer={null}
                  width={200}
                  style={{
                    textAlign: "center",
                  }}
                >
                  <Spin />
                </Modal>
                <Space.Compact className="compact-icons">
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
                  <ButtonComponent
                    onClick={this.props.onCreateTree}
                    title={isEditingDisabled ? isEditingDisabledMessage : "Create new Tree (C)"}
                    disabled={isEditingDisabled}
                  >
                    <i className="fas fa-plus" />
                  </ButtonComponent>
                  <ButtonComponent
                    onClick={this.handleDelete}
                    title={isEditingDisabled ? isEditingDisabledMessage : "Delete Selected Trees"}
                    disabled={isEditingDisabled}
                  >
                    <i className="far fa-trash-alt" />
                  </ButtonComponent>
                  <ButtonComponent
                    onClick={this.toggleAllTrees}
                    title="Toggle Visibility of All Trees (1)"
                    disabled={isEditingDisabled}
                  >
                    <i className="fas fa-toggle-on" />
                  </ButtonComponent>
                  <ButtonComponent
                    onClick={this.toggleInactiveTrees}
                    title="Toggle Visibility of Inactive Trees (2)"
                    disabled={isEditingDisabled}
                  >
                    <i className="fas fa-toggle-off" />
                  </ButtonComponent>
                  <Dropdown menu={this.getActionsDropdown()} trigger={["click"]}>
                    <ButtonComponent>
                      More
                      <DownOutlined />
                    </ButtonComponent>
                  </Dropdown>
                </Space.Compact>
                <Space.Compact className="compact-icons compact-items">
                  <ButtonComponent
                    onClick={this.props.onSelectNextTreeBackward}
                    title="Select previous tree"
                  >
                    <i className="fas fa-arrow-left" />
                  </ButtonComponent>
                  <InputComponent
                    onChange={this.handleChangeName}
                    value={activeTreeName || activeGroupName}
                    disabled={noTreesAndGroups || isEditingDisabled}
                    title={isEditingDisabled ? isEditingDisabledMessage : undefined}
                    style={{ width: "70%" }}
                  />
                  <ButtonComponent
                    onClick={this.props.onSelectNextTreeForward}
                    title="Select next tree"
                  >
                    <i className="fas fa-arrow-right" />
                  </ButtonComponent>
                  <Dropdown menu={this.getSettingsDropdown()} trigger={["click"]}>
                    <ButtonComponent title="Sort">
                      <i className="fas fa-sort-alpha-down" />
                    </ButtonComponent>
                  </Dropdown>
                </Space.Compact>
                {!showSkeletons ? (
                  <Tooltip title={messages["tracing.skeletons_are_hidden_warning"]}>
                    <WarningOutlined
                      style={{
                        color: "var(--ant-color-warning)",
                      }}
                    />
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
                  <ul
                    style={{
                      flex: "1 1 auto",
                      overflow: "auto",
                      margin: 0,
                      padding: 0,
                    }}
                  >
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
                    onDeleteGroupAndChildren={() => {
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
  isSkeletonLayerTransformed: isSkeletonLayerTransformed(state),
  isAnnotationLockedByUser: state.tracing.isLockedByOwner,
  isOwner: isAnnotationOwner(state),
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  onShuffleAllTreeColors() {
    dispatch(shuffleAllTreeColorsAction());
  },

  onSortTree(shouldSortTreesByName: boolean) {
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

  onBatchActions(actions: Array<Action>, actionName: string) {
    dispatch(batchActions(actions, actionName));
  },

  onBatchUpdateGroupsAndTreesAction(actions: BatchableUpdateTreeAction[]) {
    dispatch(batchUpdateGroupsAndTreesAction(actions));
  },

  onSetTreeGroup(groupId: number | null | undefined, treeId: number) {
    dispatch(setTreeGroupAction(groupId, treeId));
  },

  onChangeTreeName(name: string) {
    dispatch(setTreeNameAction(name));
  },

  onSetActiveTree(treeId: number) {
    dispatch(setActiveTreeAction(treeId));
  },

  onDeselectActiveTree() {
    dispatch(deselectActiveTreeAction());
  },

  onSetActiveTreeGroup(groupId: number) {
    dispatch(setActiveTreeGroupAction(groupId));
  },

  onDeselectActiveGroup() {
    dispatch(deselectActiveTreeGroupAction());
  },

  showDropzoneModal() {
    dispatch(setDropzoneModalVisibilityAction(true));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(SkeletonTabView);
