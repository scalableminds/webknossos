import {
  DownOutlined,
  DownloadOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  UploadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { BlobReader, BlobWriter, type Entry, ZipReader } from "@zip.js/zip.js";
import { clearCache, getBuildInfo, importVolumeTracing } from "admin/rest_api";
import { Dropdown, Empty, type MenuProps, Modal, Space, Spin, Tooltip, notification } from "antd";
import { saveAs } from "file-saver";
import { formatLengthAsVx, formatNumberToLength } from "libs/format_utils";
import { readFileAsArrayBuffer, readFileAsText } from "libs/read_file";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import Zip from "libs/zipjs_wrapper";
import _ from "lodash";
import memoizeOne from "memoize-one";
import messages from "messages";
import * as React from "react";
import { connect } from "react-redux";
import type { Dispatch } from "redux";
import { batchActions } from "redux-batched-actions";
import { LongUnitToShortUnitMap } from "viewer/constants";
import { isAnnotationOwner } from "viewer/model/accessors/annotation_accessor";
import {
  areGeometriesTransformed,
  enforceSkeletonTracing,
  getActiveTree,
  getActiveTreeGroup,
  getTree,
} from "viewer/model/accessors/skeletontracing_accessor";
import { getActiveSegmentationTracing } from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import { addUserBoundingBoxesAction } from "viewer/model/actions/annotation_actions";
import { setVersionNumberAction } from "viewer/model/actions/save_actions";
import { updateUserSettingAction } from "viewer/model/actions/settings_actions";
import {
  type BatchableUpdateTreeAction,
  addTreesAndGroupsAction,
  batchUpdateGroupsAndTreesAction,
  createTreeAction,
  deleteTreesAction,
  deselectActiveTreeAction,
  deselectActiveTreeGroupAction,
  selectNextTreeAction,
  setActiveTreeAction,
  setActiveTreeGroupAction,
  setExpandedTreeGroupsByIdsAction,
  setTreeGroupAction,
  setTreeGroupsAction,
  setTreeNameAction,
  shuffleAllTreeColorsAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "viewer/model/actions/skeletontracing_actions";
import { handleDeleteTreeByUser } from "viewer/model/actions/skeletontracing_actions_with_effects";
import { setDropzoneModalVisibilityAction } from "viewer/model/actions/ui_actions";
import {
  importVolumeTracingAction,
  setLargestSegmentIdAction,
} from "viewer/model/actions/volumetracing_actions";
import { getTreeEdgesAsCSV, getTreeNodesAsCSV } from "viewer/model/helpers/csv_helpers";
import {
  NmlParseError,
  getNmlName,
  parseNml,
  serializeToNml,
  wrapInNewGroup,
} from "viewer/model/helpers/nml_helpers";
import { parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import { createMutableTreeMapFromTreeArray } from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { MutableTreeMap, Tree, TreeGroup, TreeMap } from "viewer/model/types/tree_types";
import { Model } from "viewer/singletons";
import { api } from "viewer/singletons";
import Store, { type UserBoundingBox, type WebknossosState } from "viewer/store";
import ButtonComponent from "viewer/view/components/button_component";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import InputComponent from "viewer/view/components/input_component";
import TreeHierarchyView from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view";
import {
  GroupTypeEnum,
  MISSING_GROUP_ID,
  additionallyExpandGroup,
  callDeep,
  createGroupToParentMap,
  createGroupToTreesMap,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import AdvancedSearchPopover from "../advanced_search_popover";
import DeleteGroupModalView from "../delete_group_modal_view";

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
  isDownloadingNML: boolean;
  isDownloadingCSV: boolean;
  selectedTreeIds: Array<number>;
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

    const tryParsingFileAsNml = async (file: File, warnAboutVolumes: boolean = true) => {
      try {
        const nmlString = await readFileAsText(file);
        const { trees, treeGroups, userBoundingBoxes, datasetName, containedVolumes } =
          await parseNml(nmlString);
        if (containedVolumes && warnAboutVolumes) {
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

        const nmlImportActions = await tryParsingFileAsNml(nmlFile, false);

        const dataFileEntry = entries.find((entry: Entry) =>
          Utils.isFileExtensionEqualTo(entry.filename, "zip"),
        );

        if (dataFileEntry) {
          // The type definitions for getData are inaccurate. It is defined for entries obtained through calling ZipReader.getEntries, see https://github.com/gildas-lormeau/zip.js/issues/371#issuecomment-1272316813
          const dataBlob = await dataFileEntry.getData!(new BlobWriter());
          const dataFile = new File([dataBlob], dataFileEntry.filename);
          await Model.ensureSavedState();
          const storeState = Store.getState();
          const { annotation, dataset } = storeState;

          if (annotation.volumes.length === 0) {
            throw new Error("A volume tracing must already exist when importing a volume tracing.");
          }

          const oldVolumeTracing = getActiveSegmentationTracing(storeState);

          if (oldVolumeTracing == null) {
            throw new Error(
              "Ensure that a volume tracing layer is visible when importing a volume tracing.",
            );
          }

          const newLargestSegmentId = await importVolumeTracing(
            annotation,
            oldVolumeTracing,
            dataFile,
            annotation.version,
          );

          Store.dispatch(importVolumeTracingAction());
          Store.dispatch(setVersionNumberAction(annotation.version + 1));
          Store.dispatch(setLargestSegmentIdAction(newLargestSegmentId));
          await clearCache(dataset, oldVolumeTracing.tracingId);
          await api.data.reloadBuckets(oldVolumeTracing.tracingId);
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
  const skeletonTracing = enforceSkeletonTracing(state.annotation);

  const hasNodeWithIdOne = (id: number) => getTree(skeletonTracing, id)?.nodes.has(1);

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
  constructor(props: Props) {
    super(props);
    this.state = {
      isUploading: false,
      isDownloadingNML: false,
      isDownloadingCSV: false,
      selectedTreeIds:
        props.skeletonTracing?.activeTreeId != null ? [props.skeletonTracing.activeTreeId] : [],
      groupToDelete: null,
    };
  }

  getTreeAndTreeGroupList = memoizeOne(
    (trees: TreeMap, treeGroups: Array<TreeGroup>, sortBy: string): Array<TreeOrTreeGroup> => {
      const groupToTreesMap = createGroupToTreesMap(trees);
      const rootGroup: TreeGroup = {
        name: "Root",
        groupId: MISSING_GROUP_ID,
        children: treeGroups,
        isExpanded: true,
      };

      const makeTree = (tree: Tree) => ({
        name: tree.name,
        type: GroupTypeEnum.TREE,
        id: tree.treeId,
      });

      const makeGroup = (group: TreeGroup) => ({
        name: group.name,
        type: GroupTypeEnum.GROUP,
        id: group.groupId,
      });

      function* mapGroupsAndTreesSorted(
        _groups: Array<TreeGroup>,
        _groupToTreesMap: Record<number, Array<Tree>>,
        _sortBy: string,
      ): Generator<TreeOrTreeGroup, void, undefined> {
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
      treeIdsToDelete = this.props.skeletonTracing.trees
        .values()
        .map((t) => t.treeId)
        .toArray();
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
      this.props.onBatchUpdateGroupsAndTreesAction(
        updateTreeActions.concat([
          deleteTreesAction(treeIdsToDelete),
          setTreeGroupsAction(newTreeGroups),
        ]),
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
    const { selectedTreeIds } = this.state;
    const selectedTreeCount = selectedTreeIds.length;

    if (selectedTreeCount > 1) {
      const deleteAllSelectedTrees = () => {
        checkAndConfirmDeletingInitialNode(selectedTreeIds).then(() => {
          this.props.onDeleteTrees(selectedTreeIds);
          this.setState({
            selectedTreeIds: [],
          });
        });
      };

      this.showModalConfirmWarning(
        "Delete all selected trees?",
        messages["tracing.delete_multiple_trees"]({
          countOfTrees: selectedTreeCount,
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
      isDownloadingNML: true,
    });
    // Wait 1 second for the Modal to render
    const [buildInfo] = await Promise.all([getBuildInfo(), Utils.sleep(1000)]);
    const state = Store.getState();
    const nml = serializeToNml(
      state,
      state.annotation,
      skeletonTracing,
      buildInfo,
      applyTransforms,
    );
    this.setState({
      isDownloadingNML: false,
    });
    const blob = new Blob([nml], {
      type: "text/plain;charset=utf-8",
    });
    saveAs(blob, getNmlName(state));
  };

  handleCSVDownload = async (applyTransforms: boolean) => {
    const { skeletonTracing, annotationId } = this.props;

    if (!skeletonTracing) {
      return;
    }

    this.setState({
      isDownloadingCSV: true,
    });

    try {
      const treesCsv = getTreeNodesAsCSV(Store.getState(), skeletonTracing, applyTransforms);
      const edgesCsv = getTreeEdgesAsCSV(annotationId, skeletonTracing);

      const blobWriter = new Zip.BlobWriter("application/zip");
      const writer = new Zip.ZipWriter(blobWriter);
      await writer.add("nodes.csv", new Zip.TextReader(treesCsv));
      await writer.add("edges.csv", new Zip.TextReader(edgesCsv));
      await writer.close();
      saveAs(await blobWriter.getData(), "tree_export.zip");
    } catch (e) {
      Toast.error("Could not export trees. See the console for details.");
      console.error(e);
    } finally {
      this.setState({
        isDownloadingCSV: false,
      });
    }
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

  onSingleSelectTree = (treeId: number, dispatchSetActiveTree: boolean) => {
    if (!this.props.skeletonTracing) {
      return;
    }

    this.setState({
      selectedTreeIds: [treeId],
    });
    if (dispatchSetActiveTree) {
      this.props.onSetActiveTree(treeId);
    }
  };

  onRangeSelectTrees = (ids: number[]) => {
    // Use this method only for range selecting multiple trees (SHIFT + click)
    const tracing = this.props.skeletonTracing;

    if (!tracing) {
      return;
    }
    this.setState({
      selectedTreeIds: ids,
    });
  };

  onMultiSelectTree = (id: number) => {
    // Use this method only for selecting individual trees for multi-select (CTRL + click)
    const tracing = this.props.skeletonTracing;
    const { selectedTreeIds } = this.state;

    if (!tracing) {
      return;
    }
    // If the tree was already selected
    if (selectedTreeIds.includes(id)) {
      // If the tree is the second last -> set remaining tree to be the active tree
      if (selectedTreeIds.length === 2) {
        const lastSelectedTree = selectedTreeIds.find((treeId) => treeId !== id);

        if (lastSelectedTree != null) {
          this.props.onSetActiveTree(lastSelectedTree);
        }

        this.deselectAllTrees();
      } else {
        // Just deselect the tree
        this.setState((prevState) => ({
          selectedTreeIds: prevState.selectedTreeIds.filter((currentId) => currentId !== id),
        }));
      }
    } else {
      const { activeTreeId } = tracing;

      this.props.onDeselectActiveGroup();

      if (selectedTreeIds.length === 0 && activeTreeId != null) {
        // If this is the first selected tree -> also select the active tree
        this.setState({
          selectedTreeIds: [id, activeTreeId],
        });
        // Remove the current active tree
        this.props.onDeselectActiveTree();
      } else {
        // Just select this tree
        this.setState((prevState) => ({
          selectedTreeIds: [...prevState.selectedTreeIds, id],
        }));
      }
    }
  };

  deselectAllTrees = () => {
    this.setState({
      selectedTreeIds: [],
    });
  };

  maybeExpandParentGroups = (selectedElement: TreeOrTreeGroup) => {
    const { skeletonTracing } = this.props;
    if (!skeletonTracing) {
      return;
    }
    const { trees, treeGroups } = skeletonTracing;
    const isTree = selectedElement.type === GroupTypeEnum.TREE;
    const groupToExpand = isTree
      ? trees.getNullable(selectedElement.id)?.groupId
      : createGroupToParentMap(treeGroups)[selectedElement.id];
    const expandedGroups = additionallyExpandGroup(treeGroups, groupToExpand, (groupId) => groupId);
    if (expandedGroups) {
      this.props.onSetExpandedGroups(expandedGroups);
    }
  };

  handleSearchSelect = (selectedElement: TreeOrTreeGroup) => {
    this.maybeExpandParentGroups(selectedElement);
    if (selectedElement.type === GroupTypeEnum.TREE) {
      this.props.onSetActiveTree(selectedElement.id);
    } else {
      this.props.onSetActiveTreeGroup(selectedElement.id);
    }
  };

  handleSelectAllMatchingTrees = (matchingTrees: TreeOrTreeGroup[]) => {
    this.props.onDeselectActiveGroup();
    const treeIds = matchingTrees.map((tree) => {
      this.maybeExpandParentGroups(tree);
      return tree.id;
    });
    this.setState({ selectedTreeIds: treeIds });
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
        selectedTreeIds={this.state.selectedTreeIds}
        onSingleSelectTree={this.onSingleSelectTree}
        onMultiSelectTree={this.onMultiSelectTree}
        onRangeSelectTrees={this.onRangeSelectTrees}
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
          label: "Download Visible Trees NML",
          title: "Download Visible Trees as NML",
        },
        this.props.isSkeletonLayerTransformed
          ? {
              key: "handleNmlDownloadTransformed",
              onClick: () => this.handleNmlDownload(true),
              icon: <DownloadOutlined />,
              label: "Download Visible Trees NML (Transformed)",
              title: "The currently active transformation will be applied to each node.",
            }
          : null,
        {
          key: "handleCSVDownload",
          onClick: () => this.handleCSVDownload(false),
          icon: <DownloadOutlined />,
          label: "Download Visible Trees CSV",
          title: "Download Visible Trees as CSV",
        },
        this.props.isSkeletonLayerTransformed
          ? {
              key: "handleCSVDownloadTransformed",
              onClick: () => this.handleCSVDownload(true),
              icon: <DownloadOutlined />,
              label: "Download Visible Trees (Transformed) CSV",
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

  handleMeasureAllSkeletonsLength = () => {
    const { unit } = Store.getState().dataset.dataSource.scale;
    const [totalLengthNm, totalLengthVx] = api.tracing.measureAllTrees();
    notification.open({
      message: `The total length of all skeletons is ${formatNumberToLength(
        totalLengthNm,
        LongUnitToShortUnitMap[unit],
      )} (${formatLengthAsVx(totalLengthVx)}).`,
      icon: <i className="fas fa-ruler" />,
    });
  };

  componentDidUpdate(prevProps: Props) {
    if (this.props.skeletonTracing?.activeTreeId !== prevProps.skeletonTracing?.activeTreeId) {
      if (this.props.skeletonTracing?.activeTreeId != null) {
        this.setState({
          selectedTreeIds: [this.props.skeletonTracing.activeTreeId],
        });
      } else {
        this.setState({
          selectedTreeIds: [],
        });
      }
    }
  }

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

    const { showSkeletons, trees, treeGroups } = skeletonTracing;
    const activeTreeName = getActiveTree(skeletonTracing)?.name ?? "";
    const activeGroupName = getActiveTreeGroup(skeletonTracing)?.name ?? "";
    const noTreesAndGroups = trees.size() === 0 && _.size(treeGroups) === 0;
    const orderAttribute = this.props.userConfiguration.sortTreesByName ? "name" : "timestamp";
    // Avoid that the title switches to the other title during the fadeout of the Modal
    let title = "";

    if (this.state.isDownloadingNML) {
      title = "Preparing NML";
    } else if (this.state.isDownloadingCSV) {
      title = "Preparing CSV";
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
    const isDownloading = this.state.isDownloadingCSV || this.state.isDownloadingNML;

    return (
      <div id={treeTabId} className="padded-tab-content" style={{ overflow: "hidden" }}>
        <DomVisibilityObserver targetId={treeTabId}>
          {(isVisibleInDom) =>
            !isVisibleInDom ? null : (
              <React.Fragment>
                <Modal
                  open={isDownloading || this.state.isUploading}
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
                <Space.Compact className="compact-icons compact-wrap">
                  <AdvancedSearchPopover
                    onSelect={this.handleSearchSelect}
                    data={this.getTreeAndTreeGroupList(trees, treeGroups, orderAttribute)}
                    searchKey="name"
                    provideShortcut
                    targetId={treeTabId}
                    onSelectAllMatches={this.handleSelectAllMatchingTrees}
                  >
                    <ButtonComponent
                      title="Open the search via CTRL + Shift + F"
                      className="firstButton"
                    >
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
                    <ButtonComponent style={{ overflow: "clip" }} className="lastButton">
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
                    onChange={_.noop}
                    value={activeTreeName || activeGroupName}
                    disabled
                    title="Edit the name by double-clicking the tree or by using the details table below the tree list. Note: This text field will be removed in a future update."
                    style={{ width: "80%" }}
                  />
                  <ButtonComponent
                    onClick={this.props.onSelectNextTreeForward}
                    title="Select next tree"
                  >
                    <i className="fas fa-arrow-right" />
                  </ButtonComponent>
                  <Dropdown menu={this.getSettingsDropdown()} trigger={["click"]}>
                    <ButtonComponent title="Sort" style={{ overflow: "clip" }}>
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

const mapStateToProps = (state: WebknossosState) => ({
  allowUpdate: state.annotation.restrictions.allowUpdate,
  skeletonTracing: state.annotation.skeleton,
  annotationId: state.annotation.annotationId,
  userConfiguration: state.userConfiguration,
  isSkeletonLayerTransformed: areGeometriesTransformed(state),
  isAnnotationLockedByUser: state.annotation.isLockedByOwner,
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
    handleDeleteTreeByUser();
  },

  onDeleteTrees(treeIds: number[]) {
    dispatch(deleteTreesAction(treeIds));
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

  onSetExpandedGroups(expandedTreeGroups: Set<number>) {
    dispatch(setExpandedTreeGroupsByIdsAction(expandedTreeGroups));
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
