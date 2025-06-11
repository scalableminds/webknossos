import update from "immutability-helper";
import ColorGenerator from "libs/color_generator";
import DiffableMap from "libs/diffable_map";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import type { MetadataEntryProto } from "types/api_types";
import { userSettings } from "types/schemas/user_settings.schema";
import { TreeTypeEnum } from "viewer/constants";
import {
  areGeometriesTransformed,
  findTreeByNodeId,
  getSkeletonTracing,
  getTree,
  getTreeAndNode,
} from "viewer/model/accessors/skeletontracing_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  applyUserStateToGroups,
  convertServerAdditionalAxesToFrontEnd,
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
  getApplyUserStateToTreeFn,
} from "viewer/model/reducers/reducer_helpers";
import {
  addTreesAndGroups,
  createBranchPoint,
  createComment,
  createNode,
  createTree,
  createTreeMapFromTreeArray,
  deleteBranchPoint,
  deleteComment,
  deleteEdge,
  deleteNode,
  deleteTrees,
  ensureTreeNames,
  getMaximumNodeId,
  getOrCreateTree,
  mergeTrees,
  removeMissingGroupsFromTrees,
  setExpandedTreeGroups,
  setTreeColorIndex,
  shuffleTreeColor,
  toggleAllTreesReducer,
  toggleTreeGroupReducer,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";
import { type TreeGroup, TreeMap } from "viewer/model/types/tree_types";
import type { SkeletonTracing, WebknossosState } from "viewer/store";
import {
  GroupTypeEnum,
  additionallyExpandGroup,
  getNodeKey,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { getUserStateForTracing } from "../accessors/annotation_accessor";
import { max, maxBy } from "../helpers/iterator_utils";
import { applySkeletonUpdateActionsFromServer } from "./update_action_application/skeleton";

function SkeletonTracingReducer(state: WebknossosState, action: Action): WebknossosState {
  if (action.type === "INITIALIZE_SKELETONTRACING") {
    const userState = getUserStateForTracing(
      action.tracing,
      state.activeUser,
      state.annotation.owner,
    );

    const applyUserStateToTreeFn = getApplyUserStateToTreeFn(userState);
    const trees = createTreeMapFromTreeArray(action.tracing.trees, applyUserStateToTreeFn);
    let activeNodeId = userState?.activeNodeId ?? action.tracing.activeNodeId;

    const treeGroups = applyUserStateToGroups(action.tracing.treeGroups || [], userState);
    const cachedMaxNodeId = getMaximumNodeId(trees);

    let activeTreeId = null;

    // Find active tree based on active node or pick the last tree
    if (activeNodeId != null) {
      // use activeNodeId to find active tree
      const tree = findTreeByNodeId(trees, activeNodeId);
      if (tree) {
        activeTreeId = tree.treeId;
      } else {
        // There is an activeNodeId without a corresponding tree.
        // Warn the user, since this shouldn't happen, but clear the activeNodeId
        // so that wk is usable.
        Toast.warning(
          `Annotation was initialized with active node ID ${activeNodeId}, which is not present in the trees. Falling back to last tree instead.`,
          {
            timeout: 10000,
          },
        );
        activeNodeId = undefined;
      }
    }

    // If no active tree was found yet, use the last tree
    if (activeTreeId == null) {
      const lastTree = maxBy(trees.values(), "treeId");
      if (lastTree) {
        activeTreeId = lastTree.treeId;
        // use last node for active node
        const lastNode = maxBy(lastTree.nodes.values(), "id");
        activeNodeId = lastNode?.id;
      }
    }

    const userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(
      action.tracing.userBoundingBoxes,
      userState,
    );
    const skeletonTracing: SkeletonTracing = {
      createdTimestamp: action.tracing.createdTimestamp,
      type: "skeleton",
      activeNodeId,
      cachedMaxNodeId,
      activeTreeId,
      activeGroupId: null,
      trees,
      treeGroups,
      tracingId: action.tracing.id,
      boundingBox: convertServerBoundingBoxToFrontend(action.tracing.boundingBox),
      userBoundingBoxes,
      navigationList: {
        list: [],
        activeIndex: -1,
      },
      showSkeletons: true,
      additionalAxes: convertServerAdditionalAxesToFrontEnd(action.tracing.additionalAxes),
    };

    return update(state, {
      annotation: {
        skeleton: {
          $set: skeletonTracing,
        },
        readOnly: {
          $set: null,
        },
      },
    });
  }

  const skeletonTracing = getSkeletonTracing(state.annotation);
  if (skeletonTracing == null) {
    return state;
  }

  /**
   * ATTENTION: The actions that should be executed regardless of whether allowUpdate is true or false
   * should be added here!
   */
  switch (action.type) {
    case "SET_ACTIVE_NODE": {
      const { nodeId } = action;

      if (nodeId == null) {
        return update(state, {
          annotation: {
            skeleton: {
              activeNodeId: {
                $set: null,
              },
              activeTreeId: {
                $set: null,
              },
              activeGroupId: {
                $set: null,
              },
            },
          },
        });
      }

      const tree = findTreeByNodeId(skeletonTracing.trees, nodeId);
      if (tree) {
        return update(state, {
          annotation: {
            skeleton: {
              activeNodeId: {
                $set: nodeId,
              },
              activeTreeId: {
                $set: tree.treeId,
              },
              activeGroupId: {
                $set: null,
              },
            },
          },
        });
      } else {
        return state;
      }
    }

    case "SET_NODE_RADIUS": {
      const { radius, nodeId, treeId } = action;
      const clampedRadius = Utils.clamp(
        userSettings.nodeRadius.minimum,
        radius,
        userSettings.nodeRadius.maximum,
      );
      const treeAndNode = getTreeAndNode(skeletonTracing, nodeId, treeId);
      if (treeAndNode == null) {
        return state;
      }

      const [tree, node] = treeAndNode;
      const diffableMap = skeletonTracing.trees.getOrThrow(tree.treeId).nodes;
      const newDiffableMap = diffableMap.set(
        node.id,
        update(node, {
          radius: {
            $set: clampedRadius,
          },
        }),
      );
      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        nodes: newDiffableMap,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_SHOW_SKELETONS": {
      const { showSkeletons } = action;
      return update(state, {
        annotation: {
          skeleton: {
            showSkeletons: {
              $set: showSkeletons,
            },
          },
        },
      });
    }

    case "SET_ACTIVE_TREE": {
      const { trees } = skeletonTracing;
      const tree = getTree(skeletonTracing, action.treeId);
      if (tree == null) {
        return state;
      }

      const newActiveNodeId = maxBy(trees.getOrThrow(tree.treeId).nodes.values(), "id")?.id || null;
      return update(state, {
        annotation: {
          skeleton: {
            activeNodeId: {
              $set: newActiveNodeId,
            },
            activeTreeId: {
              $set: tree.treeId,
            },
            activeGroupId: {
              $set: null,
            },
          },
        },
      });
    }

    case "SET_ACTIVE_TREE_BY_NAME": {
      const { treeName } = action;
      const { trees } = skeletonTracing;

      const treeWithMatchingName = trees.values().find((tree) => tree.name === treeName);

      if (!treeWithMatchingName) {
        return state;
      }

      const newActiveNodeId = max(treeWithMatchingName.nodes.values().map((el) => el.id)) || null;
      return update(state, {
        annotation: {
          skeleton: {
            activeNodeId: {
              $set: newActiveNodeId,
            },
            activeTreeId: {
              $set: treeWithMatchingName.treeId,
            },
            activeGroupId: {
              $set: null,
            },
          },
        },
      });
    }

    case "DESELECT_ACTIVE_TREE": {
      return update(state, {
        annotation: {
          skeleton: {
            activeNodeId: {
              $set: null,
            },
            activeTreeId: {
              $set: null,
            },
          },
        },
      });
    }

    case "SET_TREE_ACTIVE_GROUP": {
      return update(state, {
        annotation: {
          skeleton: {
            activeNodeId: {
              $set: null,
            },
            activeTreeId: {
              $set: null,
            },
            activeGroupId: {
              $set: action.groupId,
            },
          },
        },
      });
    }

    case "DESELECT_ACTIVE_TREE_GROUP": {
      return update(state, {
        annotation: {
          skeleton: {
            activeGroupId: {
              $set: null,
            },
          },
        },
      });
    }

    case "SELECT_NEXT_TREE": {
      const { activeTreeId, trees } = skeletonTracing;
      if (_.values(trees).length === 0) return state;
      const increaseDecrease = action.forward ? 1 : -1;
      const orderAttribute = state.userConfiguration.sortTreesByName ? "name" : "timestamp";

      const treeIds = _.orderBy(trees.values().toArray(), [orderAttribute]).map((t) => t.treeId);

      // default to the first tree
      const activeTreeIdIndex = activeTreeId != null ? treeIds.indexOf(activeTreeId) : 0;
      // treeIds.length is taken into account in this calculation, because -1 % n == -1
      const newActiveTreeIdIndex =
        (activeTreeIdIndex + increaseDecrease + treeIds.length) % treeIds.length;

      const newActiveTreeId = treeIds[newActiveTreeIdIndex];
      const newActiveNodeId = maxBy(trees.getOrThrow(newActiveTreeId).nodes.values(), "id")?.id;

      return update(state, {
        annotation: {
          skeleton: {
            activeTreeId: {
              $set: newActiveTreeId,
            },
            activeNodeId: {
              $set: newActiveNodeId,
            },
            activeGroupId: {
              $set: null,
            },
          },
        },
      });
    }

    case "SET_TREE_COLOR_INDEX": {
      const { colorIndex } = action;
      const tree = getTree(skeletonTracing, action.treeId);
      if (tree == null) {
        return state;
      }

      const result = setTreeColorIndex(skeletonTracing, tree, colorIndex);
      if (result == null) {
        return state;
      }
      const [updatedTree, treeId] = result;
      const newTrees = skeletonTracing.trees.set(treeId, updatedTree);

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_TREE_COLOR": {
      const { color, treeId } = action;
      const tree = getTree(skeletonTracing, treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, { ...tree, color });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SHUFFLE_TREE_COLOR": {
      const tree = getTree(skeletonTracing, action.treeId);
      if (tree == null) {
        return state;
      }

      const result = shuffleTreeColor(skeletonTracing, tree);
      if (result == null) {
        return state;
      }
      const [updatedTree, treeId] = result;
      const newTrees = skeletonTracing.trees.set(treeId, updatedTree);

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_TREE_TYPE": {
      const { treeType, treeId } = action;
      const tree = getTree(skeletonTracing, treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(treeId, { ...tree, type: treeType });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SHUFFLE_ALL_TREE_COLORS": {
      const newColors = ColorGenerator.getNRandomColors(skeletonTracing.trees.size());

      const newTrees = skeletonTracing.trees.clone();
      for (const tree of skeletonTracing.trees.values()) {
        // @ts-ignore newColors.shift() can be undefined
        newTrees.mutableSet(tree.treeId, { ...tree, color: newColors.shift() });
      }

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_SKELETON_TRACING": {
      return update(state, {
        annotation: {
          skeleton: {
            $set: action.tracing,
          },
        },
      });
    }

    case "TOGGLE_TREE": {
      const { treeId } = action;
      const tree = getTree(skeletonTracing, treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        isVisible: !tree.isVisible,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_TREE_VISIBILITY": {
      const { treeId, isVisible } = action;
      const tree = getTree(skeletonTracing, treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, { ...tree, isVisible });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_EXPANDED_TREE_GROUPS_BY_KEYS": {
      const { expandedGroups } = action;

      return setExpandedTreeGroups(state, (group: TreeGroup) =>
        expandedGroups.has(getNodeKey(GroupTypeEnum.GROUP, group.groupId)),
      );
    }

    case "SET_EXPANDED_TREE_GROUPS_BY_IDS": {
      const { expandedGroups } = action;

      return setExpandedTreeGroups(state, (group: TreeGroup) => expandedGroups.has(group.groupId));
    }

    case "EXPAND_PARENT_GROUPS_OF_TREE": {
      const { tree } = action;
      if (tree.groupId == null || skeletonTracing == null) {
        return state;
      }
      const expandedGroups = additionallyExpandGroup(
        skeletonTracing.treeGroups,
        tree.groupId,
        _.identity,
      );
      if (expandedGroups == null) {
        return state;
      }
      return setExpandedTreeGroups(state, (group: TreeGroup) => expandedGroups.has(group.groupId));
    }

    case "TOGGLE_ALL_TREES": {
      return toggleAllTreesReducer(state, skeletonTracing);
    }

    case "TOGGLE_INACTIVE_TREES": {
      const { activeGroupId } = skeletonTracing;

      if (activeGroupId != null) {
        // Toggle all trees
        const toggledTreeState = toggleAllTreesReducer(state, skeletonTracing);

        if (toggledTreeState.annotation.skeleton == null) {
          throw new Error("Satisfy typescript");
        }

        // Ensure the active group is visible
        return toggleTreeGroupReducer(
          toggledTreeState,
          toggledTreeState.annotation.skeleton,
          activeGroupId,
          true,
        );
      }

      const activeTree = getTree(skeletonTracing);
      if (activeTree == null) {
        return state;
      }

      const toggledTreeState = toggleAllTreesReducer(state, skeletonTracing);
      if (toggledTreeState.annotation.skeleton == null) {
        // Skeleton should not have become null in the meantime
        throw new Error("Skeleton must not be null");
      }
      const newTrees = toggledTreeState.annotation.skeleton.trees.set(activeTree.treeId, {
        ...activeTree,
        isVisible: true,
      });

      return update(toggledTreeState, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "TOGGLE_TREE_GROUP":
      return toggleTreeGroupReducer(state, skeletonTracing, action.groupId);

    case "UPDATE_NAVIGATION_LIST": {
      const { list, activeIndex } = action;
      return update(state, {
        annotation: {
          skeleton: {
            navigationList: {
              list: {
                $set: list,
              },
              activeIndex: {
                $set: activeIndex,
              },
            },
          },
        },
      });
    }

    case "SET_MERGER_MODE_ENABLED": {
      const { active } = action;
      return update(state, {
        temporaryConfiguration: {
          isMergerModeEnabled: {
            $set: active,
          },
        },
      });
    }

    case "APPLY_SKELETON_UPDATE_ACTIONS_FROM_SERVER": {
      const { actions } = action;
      return applySkeletonUpdateActionsFromServer(SkeletonTracingReducer, actions, state).value;
    }

    default: // pass
  }

  /**
   * ATTENTION: The following actions are only executed if allowUpdate is true!
   */
  const { restrictions } = state.annotation;
  const { allowUpdate } = restrictions;
  if (!allowUpdate) return state;

  switch (action.type) {
    case "CREATE_NODE": {
      if (areGeometriesTransformed(state)) {
        // Don't create nodes if the skeleton layer is rendered with transforms.
        return state;
      }

      // use this code as template
      const { position, rotation, viewport, mag, treeId, timestamp, additionalCoordinates } =
        action;
      const tree = getOrCreateTree(state, skeletonTracing, treeId, timestamp, TreeTypeEnum.DEFAULT);
      if (tree == null) {
        return state;
      }

      const nodeResult = createNode(
        state,
        skeletonTracing,
        tree,
        position,
        additionalCoordinates,
        rotation,
        viewport,
        mag,
        timestamp,
      );
      if (nodeResult == null) {
        return state;
      }

      const [node, edges] = nodeResult;
      const diffableNodeMap = tree.nodes;
      const newDiffableMap = diffableNodeMap.set(node.id, node);
      const newTree = update(tree, {
        nodes: {
          $set: newDiffableMap,
        },
        edges: {
          $set: edges,
        },
      });
      const activeNodeId = action.dontActivate ? skeletonTracing.activeNodeId : node.id;
      const activeTreeId = action.dontActivate ? skeletonTracing.activeTreeId : tree.treeId;

      const newTrees = skeletonTracing.trees.set(tree.treeId, newTree);

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
            activeNodeId: {
              $set: activeNodeId,
            },
            activeGroupId: {
              $set: null,
            },
            cachedMaxNodeId: {
              $set: node.id,
            },
            activeTreeId: {
              $set: activeTreeId,
            },
          },
        },
      });
    }

    case "DELETE_NODE": {
      const { timestamp, nodeId, treeId } = action;
      const treeAndNode = getTreeAndNode(skeletonTracing, nodeId, treeId, TreeTypeEnum.DEFAULT);
      if (treeAndNode == null) {
        return state;
      }

      const [tree, node] = treeAndNode;
      const deleteResult = deleteNode(state, tree, node, timestamp);
      if (deleteResult == null) {
        return state;
      }

      const [trees, newActiveTreeId, newActiveNodeId, newMaxNodeId] = deleteResult;
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: trees,
            },
            activeNodeId: {
              $set: newActiveNodeId,
            },
            activeTreeId: {
              $set: newActiveTreeId,
            },
            activeGroupId: {
              $set: null,
            },
            cachedMaxNodeId: {
              $set: newMaxNodeId,
            },
          },
        },
      });
    }

    case "DELETE_EDGE": {
      const { timestamp, sourceNodeId, targetNodeId } = action;

      if (sourceNodeId === targetNodeId) {
        return state;
      }
      const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
      const treeType = isProofreadingActive ? TreeTypeEnum.AGGLOMERATE : TreeTypeEnum.DEFAULT;

      const sourceTree = getTreeAndNode(skeletonTracing, sourceNodeId, null, treeType);
      const targetTree = getTreeAndNode(skeletonTracing, targetNodeId, null, treeType);
      if (sourceTree == null || targetTree == null) {
        return state;
      }

      const [sourceTreeObj, sourceNode] = sourceTree;
      const [targetTreeObj, targetNode] = targetTree;

      const deleteEdgeResult = deleteEdge(
        state,
        sourceTreeObj,
        sourceNode,
        targetTreeObj,
        targetNode,
        timestamp,
      );
      if (deleteEdgeResult == null) {
        return state;
      }

      const [trees, newActiveTreeId] = deleteEdgeResult;
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: trees,
            },
            activeTreeId: {
              $set: newActiveTreeId,
            },
          },
        },
      });
    }

    case "SET_NODE_POSITION": {
      if (areGeometriesTransformed(state)) {
        // Don't move node if the skeleton layer is rendered with transforms.
        return state;
      }
      const { position, nodeId, treeId } = action;
      const treeAndNode = getTreeAndNode(skeletonTracing, nodeId, treeId, TreeTypeEnum.DEFAULT);
      if (treeAndNode == null) {
        return state;
      }

      const [tree, node] = treeAndNode;
      const nodesMap = skeletonTracing.trees.getOrThrow(tree.treeId).nodes;
      const newNodesMap = nodesMap.set(
        node.id,
        update(node, {
          untransformedPosition: {
            // Don't round here, since this would make the continuous
            // movement of a node weird.
            $set: position,
          },
        }),
      );

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        nodes: newNodesMap,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "CREATE_BRANCHPOINT": {
      const { timestamp, nodeId, treeId } = action;
      const treeAndNode = getTreeAndNode(skeletonTracing, nodeId, treeId);
      if (treeAndNode == null) {
        return state;
      }

      const [tree, node] = treeAndNode;
      const branchPoint = createBranchPoint(tree, node, timestamp, restrictions);
      if (branchPoint == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        branchPoints: [...tree.branchPoints, branchPoint],
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "DELETE_BRANCHPOINT": {
      const branchPointResult = deleteBranchPoint(skeletonTracing, restrictions);
      if (branchPointResult == null) {
        return state;
      }
      const [branchPoints, treeId, newActiveNodeId] = branchPointResult;
      const tree = skeletonTracing.trees.getOrThrow(treeId);
      const newTrees = skeletonTracing.trees.set(treeId, {
        ...tree,
        branchPoints,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
            activeNodeId: {
              $set: newActiveNodeId,
            },
            activeTreeId: {
              $set: treeId,
            },
            activeGroupId: {
              $set: null,
            },
          },
        },
      });
    }

    case "DELETE_BRANCHPOINT_BY_ID": {
      const { nodeId, treeId } = action;
      const tree = getTree(skeletonTracing, treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        branchPoints: tree.branchPoints.filter((bp: any) => bp.nodeId !== nodeId),
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "CREATE_TREE": {
      const { timestamp } = action;
      const tree = createTree(state, timestamp);
      if (tree == null) {
        return state;
      }

      if (action.treeIdCallback) {
        action.treeIdCallback(tree.treeId);
      }
      const newTrees = skeletonTracing.trees.set(tree.treeId, tree);

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
            activeNodeId: {
              $set: null,
            },
            activeTreeId: {
              $set: tree.treeId,
            },
            activeGroupId: {
              $set: null,
            },
          },
        },
      });
    }

    case "ADD_TREES_AND_GROUPS": {
      const { trees, treeGroups, assignNewGroupId } = action;
      const treesWithNames = ensureTreeNames(state, trees);
      const treesResult = addTreesAndGroups(
        skeletonTracing,
        treesWithNames,
        treeGroups,
        assignNewGroupId,
      );
      if (treesResult == null) {
        return state;
      }

      const [updatedTrees, updatedTreeGroups, newMaxNodeId] = treesResult;
      if (action.treeIdsCallback) {
        action.treeIdsCallback(
          updatedTrees
            .values()
            .map((tree) => tree.treeId)
            .toArray(),
        );
      }

      const newTrees = DiffableMap.merge(skeletonTracing.trees, updatedTrees);

      return update(state, {
        annotation: {
          skeleton: {
            treeGroups: {
              $push: updatedTreeGroups,
            },
            trees: {
              $set: newTrees,
            },
            cachedMaxNodeId: {
              $set: newMaxNodeId,
            },
          },
        },
      });
    }

    case "DELETE_TREE":
    case "DELETE_TREES": {
      const { suppressActivatingNextNode } = action;
      let treeIds: number[] = [];

      if (action.type === "DELETE_TREE") {
        const tree = getTree(skeletonTracing, action.treeId);
        if (tree != null) {
          treeIds = [tree.treeId];
        }
      } else {
        treeIds = action.treeIds;
      }

      const deleteResult = deleteTrees(skeletonTracing, treeIds, suppressActivatingNextNode);
      if (deleteResult == null) {
        return state;
      }

      const [trees, newActiveTreeId, newActiveNodeId, newMaxNodeId] = deleteResult;
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: trees,
            },
            activeTreeId: {
              $set: newActiveTreeId,
            },
            activeNodeId: {
              $set: newActiveNodeId,
            },
            activeGroupId: {
              $set: null,
            },
            cachedMaxNodeId: {
              $set: newMaxNodeId,
            },
          },
        },
      });
    }

    case "RESET_SKELETON_TRACING": {
      const newTree = createTree(state, Date.now(), false);
      if (newTree == null) {
        return state;
      }

      const newTreeMap: TreeMap = new TreeMap([[newTree.treeId, newTree]]);

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTreeMap,
            },
            activeTreeId: {
              $set: newTree.treeId,
            },
            activeNodeId: {
              $set: null,
            },
            activeGroupId: {
              $set: null,
            },
            treeGroups: {
              $set: [],
            },
          },
        },
      });
    }

    case "MERGE_TREES": {
      const { sourceNodeId, targetNodeId } = action;
      const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
      const treeType = isProofreadingActive ? TreeTypeEnum.AGGLOMERATE : TreeTypeEnum.DEFAULT;
      const oldTrees = skeletonTracing.trees;
      const mergeResult = mergeTrees(oldTrees, sourceNodeId, targetNodeId, treeType);

      if (mergeResult == null) {
        return state;
      }
      const [trees, newActiveTreeId, newActiveNodeId] = mergeResult;

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: trees,
            },
            activeNodeId: {
              $set: newActiveNodeId,
            },
            activeTreeId: {
              $set: newActiveTreeId,
            },
            activeGroupId: {
              $set: null,
            },
          },
        },
      });
    }

    case "SET_TREE_NAME": {
      const tree = getTree(skeletonTracing, action.treeId);
      if (tree == null) {
        return state;
      }

      const defaultName = `Tree${Utils.zeroPad(tree.treeId, 3)}`;
      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        name: action.name || defaultName,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_TREE_METADATA": {
      const tree = getTree(skeletonTracing, action.treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        metadata: sanitizeMetadata(action.metadata),
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_EDGES_ARE_VISIBLE": {
      const tree = getTree(skeletonTracing, action.treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        edgesAreVisible: action.edgesAreVisible,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "CREATE_COMMENT": {
      const { commentText, nodeId, treeId } = action;
      const treeAndNode = getTreeAndNode(skeletonTracing, nodeId, treeId);
      if (treeAndNode == null) {
        return state;
      }

      const [tree, node] = treeAndNode;
      const comments = createComment(skeletonTracing, tree, node, commentText);
      if (comments == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        comments,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "DELETE_COMMENT": {
      const treeAndNode = getTreeAndNode(skeletonTracing, action.nodeId, action.treeId);
      if (treeAndNode == null) {
        return state;
      }

      const [tree, node] = treeAndNode;
      const comments = deleteComment(skeletonTracing, tree, node);
      if (comments == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        comments,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_TREE_GROUPS": {
      const { treeGroups } = action;

      const updatedTrees = removeMissingGroupsFromTrees(skeletonTracing, treeGroups);
      const newTrees = DiffableMap.merge(skeletonTracing.trees, updatedTrees);

      return update(state, {
        annotation: {
          skeleton: {
            treeGroups: {
              $set: action.treeGroups,
            },
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    case "SET_TREE_GROUP": {
      const { treeId, groupId } = action;
      const tree = getTree(skeletonTracing, treeId);
      if (tree == null) {
        return state;
      }

      const newTrees = skeletonTracing.trees.set(tree.treeId, {
        ...tree,
        groupId,
      });

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTrees,
            },
          },
        },
      });
    }

    default:
      return state;
  }
}

export function sanitizeMetadata(metadata: MetadataEntryProto[]) {
  // Workaround for stringList values that are [], even though they
  // should be null. This workaround is necessary because protobuf cannot
  // distinguish between an empty list and an not existent property.
  // Therefore, we clean this up here.
  return metadata.map((prop) => {
    // If stringList value is defined, but it's an empty array, it should
    // be switched to undefined
    const needsCorrection =
      prop.stringListValue != null &&
      prop.stringListValue.length === 0 &&
      (prop.stringValue != null || prop.numberValue != null || prop.boolValue != null);
    if (needsCorrection) {
      return {
        ...prop,
        stringListValue: undefined,
      };
    }
    return prop;
  });
}

export default SkeletonTracingReducer;
