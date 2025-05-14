import update from "immutability-helper";
import ColorGenerator from "libs/color_generator";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import type { MetadataEntryProto } from "types/api_types";
import { userSettings } from "types/schemas/user_settings.schema";
import Constants, { TreeTypeEnum } from "viewer/constants";
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
  applyUserStateToTrees,
  convertServerAdditionalAxesToFrontEnd,
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
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
  getOrCreateTree,
  mergeTrees,
  removeMissingGroupsFromTrees,
  setExpandedTreeGroups,
  setTreeColorIndex,
  shuffleTreeColor,
  toggleAllTreesReducer,
  toggleTreeGroupReducer,
} from "viewer/model/reducers/skeletontracing_reducer_helpers";
import type { SkeletonTracing, TreeGroup, WebknossosState } from "viewer/store";
import {
  GroupTypeEnum,
  getNodeKey,
} from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";

function SkeletonTracingReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "INITIALIZE_SKELETONTRACING": {
      // todop: replace _.first to select the proper user
      const userState = _.first(action.tracing.userStates);

      // Perf idea: applyUserStateToTrees could theoretically happen
      // within createTreeMapFromTreeArray. Performance would probably
      // be better, but priority is unclear. Would make the code a bit
      // less separated, though.
      const trees = applyUserStateToTrees(
        createTreeMapFromTreeArray(action.tracing.trees),
        userState,
      );
      let activeNodeId = userState?.activeNodeId;

      const treeGroups = applyUserStateToGroups(action.tracing.treeGroups || [], userState);

      let cachedMaxNodeId = _.max(_.flatMap(trees, (__) => __.nodes.map((node) => node.id)));
      cachedMaxNodeId = cachedMaxNodeId != null ? cachedMaxNodeId : Constants.MIN_NODE_ID - 1;

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
        const lastTree = _.maxBy(_.values(trees), (tree) => tree.treeId);
        if (lastTree) {
          activeTreeId = lastTree.treeId;
          // use last node for active node
          const lastNode = _.maxBy(Array.from(lastTree.nodes.values()), (node) => node.id);
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
        },
      });
    }

    default: // pass
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
      const diffableMap = skeletonTracing.trees[tree.treeId].nodes;
      const newDiffableMap = diffableMap.set(
        node.id,
        update(node, {
          radius: {
            $set: clampedRadius,
          },
        }),
      );
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                nodes: {
                  $set: newDiffableMap,
                },
              },
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

      const newActiveNodeId = _.max(trees[tree.treeId].nodes.map((el) => el.id)) || null;
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

      const treeWithMatchingName = _.values(trees).find((tree) => tree.name === treeName);

      if (!treeWithMatchingName) {
        return state;
      }

      const newActiveNodeId = _.max(treeWithMatchingName.nodes.map((el) => el.id)) || null;
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

      const treeIds = _.orderBy(_.values(trees), [orderAttribute]).map((t) => t.treeId);

      // default to the first tree
      const activeTreeIdIndex = activeTreeId != null ? treeIds.indexOf(activeTreeId) : 0;
      // treeIds.length is taken into account in this calculation, because -1 % n == -1
      const newActiveTreeIdIndex =
        (activeTreeIdIndex + increaseDecrease + treeIds.length) % treeIds.length;
      const newActiveTreeId = treeIds[newActiveTreeIdIndex];
      const newActiveNodeId = _.max(trees[newActiveTreeId].nodes.map((el) => el.id)) || null;
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
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [treeId]: {
                $set: updatedTree,
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                color: {
                  $set: color,
                },
              },
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
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [treeId]: {
                $set: updatedTree,
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                type: {
                  $set: treeType,
                },
              },
            },
          },
        },
      });
    }

    case "SHUFFLE_ALL_TREE_COLORS": {
      const newColors = ColorGenerator.getNRandomColors(_.size(skeletonTracing.trees));
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $apply: (oldTrees) =>
                _.mapValues(oldTrees, (tree) =>
                  update(tree, {
                    color: {
                      // @ts-expect-error ts-migrate(2322) FIXME: Type 'Vector3 | undefined' is not assignable to ty... Remove this comment to see the full error message
                      $set: newColors.shift(),
                    },
                  }),
                ),
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                isVisible: {
                  $apply: (bool) => !bool,
                },
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                isVisible: {
                  $set: isVisible,
                },
              },
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

      return update(toggleAllTreesReducer(state, skeletonTracing), {
        annotation: {
          skeleton: {
            trees: {
              [activeTree.treeId]: {
                isVisible: {
                  $set: true,
                },
              },
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
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                $set: newTree,
              },
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
      const diffableMap = skeletonTracing.trees[tree.treeId].nodes;
      const newDiffableMap = diffableMap.set(
        node.id,
        update(node, {
          untransformedPosition: {
            // Don't round here, since this would make the continuous
            // movement of a node weird.
            $set: position,
          },
        }),
      );
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                nodes: {
                  $set: newDiffableMap,
                },
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                branchPoints: {
                  $push: [branchPoint],
                },
              },
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
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [treeId]: {
                branchPoints: {
                  $set: branchPoints,
                },
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [treeId]: {
                branchPoints: {
                  $set: tree.branchPoints.filter((bp) => bp.nodeId !== nodeId),
                },
              },
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
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                $set: tree,
              },
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
      const { trees, treeGroups } = action;
      const treesWithNames = ensureTreeNames(state, trees);
      const treesResult = addTreesAndGroups(skeletonTracing, treesWithNames, treeGroups);
      if (treesResult == null) {
        return state;
      }

      const [updatedTrees, updatedTreeGroups, newMaxNodeId] = treesResult;
      if (action.treeIdsCallback) {
        action.treeIdsCallback(Utils.values(updatedTrees).map((tree) => tree.treeId));
      }
      return update(state, {
        annotation: {
          skeleton: {
            treeGroups: {
              $push: updatedTreeGroups,
            },
            trees: {
              $merge: updatedTrees,
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

      const newTreesObject = {
        [newTree.treeId]: newTree,
      };

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              $set: newTreesObject,
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
      const newName = action.name || defaultName;
      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                name: {
                  $set: newName,
                },
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                metadata: {
                  $set: sanitizeMetadata(action.metadata),
                },
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                edgesAreVisible: {
                  $set: action.edgesAreVisible,
                },
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                comments: {
                  $set: comments,
                },
              },
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                comments: {
                  $set: comments,
                },
              },
            },
          },
        },
      });
    }

    case "SET_TREE_GROUPS": {
      const { treeGroups } = action;
      const updatedTrees = removeMissingGroupsFromTrees(skeletonTracing, treeGroups);
      return update(state, {
        annotation: {
          skeleton: {
            treeGroups: {
              $set: action.treeGroups,
            },
            trees: {
              $merge: updatedTrees,
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

      return update(state, {
        annotation: {
          skeleton: {
            trees: {
              [tree.treeId]: {
                groupId: {
                  $set: groupId,
                },
              },
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
