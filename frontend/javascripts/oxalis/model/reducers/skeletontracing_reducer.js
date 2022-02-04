/**
 * skeletontracing_reducer.js
 * @flow
 */

import Maybe from "data.maybe";
import _ from "lodash";
import update from "immutability-helper";

import type { Action } from "oxalis/model/actions/actions";
import type { OxalisState, SkeletonTracing } from "oxalis/store";
import {
  convertServerBoundingBoxToFrontend,
  convertUserBoundingBoxesFromServerToFrontend,
} from "oxalis/model/reducers/reducer_helpers";
import {
  createBranchPoint,
  deleteBranchPoint,
  createNode,
  createTree,
  deleteTree,
  deleteNode,
  deleteEdge,
  shuffleTreeColor,
  setTreeColorIndex,
  createComment,
  deleteComment,
  mergeTrees,
  toggleAllTreesReducer,
  toggleTreeGroupReducer,
  addTreesAndGroups,
  createTreeMapFromTreeArray,
  removeMissingGroupsFromTrees,
  getOrCreateTree,
  ensureTreeNames,
} from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import {
  getSkeletonTracing,
  findTreeByNodeId,
  getTree,
  getNodeAndTree,
} from "oxalis/model/accessors/skeletontracing_accessor";
import ColorGenerator from "libs/color_generator";
import Constants from "oxalis/constants";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { userSettings } from "types/schemas/user_settings.schema";

function SkeletonTracingReducer(state: OxalisState, action: Action): OxalisState {
  switch (action.type) {
    case "INITIALIZE_SKELETONTRACING": {
      const trees = createTreeMapFromTreeArray(action.tracing.trees);

      const activeNodeIdMaybe = Maybe.fromNullable(action.tracing.activeNodeId);
      let cachedMaxNodeId = _.max(_.flatMap(trees, __ => __.nodes.map(node => node.id)));
      cachedMaxNodeId = cachedMaxNodeId != null ? cachedMaxNodeId : Constants.MIN_NODE_ID - 1;

      let activeNodeId = Utils.toNullable(activeNodeIdMaybe);
      const activeTreeIdMaybe = activeNodeIdMaybe
        .chain(nodeId => {
          // use activeNodeId to find active tree
          const treeIdMaybe = findTreeByNodeId(trees, nodeId).map(tree => tree.treeId);
          if (treeIdMaybe.isNothing) {
            // There is an activeNodeId without a corresponding tree.
            // Warn the user, since this shouldn't happen, but clear the activeNodeId
            // so that wk is usable.
            Toast.warning(
              `Annotation was initialized with active node ID ${nodeId}, which is not present in the trees. Falling back to last tree instead.`,
              { timeout: 10000 },
            );
            activeNodeId = null;
          }
          return treeIdMaybe;
        })
        .orElse(() => {
          // use last tree for active tree
          const lastTree = Maybe.fromNullable(_.maxBy(_.values(trees), tree => tree.treeId));
          return lastTree.map(t => {
            // use last node for active node
            const lastNode = _.maxBy(Array.from(t.nodes.values()), node => node.id);
            activeNodeId = lastNode != null ? lastNode.id : null;
            return t.treeId;
          });
        });
      const activeTreeId = Utils.toNullable(activeTreeIdMaybe);
      const userBoundingBoxes = convertUserBoundingBoxesFromServerToFrontend(
        action.tracing.userBoundingBoxes,
      );
      const skeletonTracing: SkeletonTracing = {
        createdTimestamp: action.tracing.createdTimestamp,
        type: "skeleton",
        activeNodeId,
        cachedMaxNodeId,
        activeTreeId,
        activeGroupId: null,
        trees,
        treeGroups: action.tracing.treeGroups || [],
        tracingId: action.tracing.id,
        version: action.tracing.version,
        boundingBox: convertServerBoundingBoxToFrontend(action.tracing.boundingBox),
        userBoundingBoxes,
        navigationList: { list: [], activeIndex: -1 },
        showSkeletons: true,
      };

      return update(state, { tracing: { skeleton: { $set: skeletonTracing } } });
    }
    default:
    // pass
  }

  return getSkeletonTracing(state.tracing)
    .map(skeletonTracing => {
      /**
       * ATTENTION: The actions that should be executed regardless of whether allowUpdate is true or false
       * should be added here!
       */

      switch (action.type) {
        case "SET_ACTIVE_NODE": {
          const { nodeId } = action;
          return findTreeByNodeId(skeletonTracing.trees, nodeId)
            .map(tree =>
              update(state, {
                tracing: {
                  skeleton: {
                    activeNodeId: { $set: nodeId },
                    activeTreeId: { $set: tree.treeId },
                    activeGroupId: { $set: null },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "SET_NODE_RADIUS": {
          const { radius, nodeId, treeId } = action;
          const clampedRadius = Utils.clamp(
            userSettings.nodeRadius.minimum,
            radius,
            userSettings.nodeRadius.maximum,
          );
          return getNodeAndTree(skeletonTracing, nodeId, treeId)
            .map(([tree, node]) => {
              const diffableMap = skeletonTracing.trees[tree.treeId].nodes;
              const newDiffableMap = diffableMap.set(
                node.id,
                update(node, { radius: { $set: clampedRadius } }),
              );
              return update(state, {
                tracing: {
                  skeleton: {
                    trees: {
                      [tree.treeId]: { nodes: { $set: newDiffableMap } },
                    },
                  },
                },
              });
            })
            .getOrElse(state);
        }

        case "SET_SHOW_SKELETONS": {
          const { showSkeletons } = action;
          return update(state, {
            tracing: {
              skeleton: {
                showSkeletons: { $set: showSkeletons },
              },
            },
          });
        }

        case "SET_ACTIVE_TREE": {
          const { trees } = skeletonTracing;

          return getTree(skeletonTracing, action.treeId)
            .map(tree => {
              const newActiveNodeId = _.max(trees[tree.treeId].nodes.map(el => el.id)) || null;

              return update(state, {
                tracing: {
                  skeleton: {
                    activeNodeId: { $set: newActiveNodeId },
                    activeTreeId: { $set: tree.treeId },
                    activeGroupId: { $set: null },
                  },
                },
              });
            })
            .getOrElse(state);
        }
        case "SET_ACTIVE_TREE_BY_NAME": {
          const { treeName } = action;
          const { trees } = skeletonTracing;
          const treeWithMatchingName = _.values(trees).find(tree => tree.name === treeName);
          if (!treeWithMatchingName) {
            return state;
          }
          const newActiveNodeId = _.max(treeWithMatchingName.nodes.map(el => el.id)) || null;

          return update(state, {
            tracing: {
              skeleton: {
                activeNodeId: { $set: newActiveNodeId },
                activeTreeId: { $set: treeWithMatchingName.treeId },
                activeGroupId: { $set: null },
              },
            },
          });
        }

        case "DESELECT_ACTIVE_TREE": {
          return update(state, {
            tracing: {
              skeleton: {
                activeNodeId: { $set: null },
                activeTreeId: { $set: null },
              },
            },
          });
        }

        case "SET_ACTIVE_GROUP": {
          return update(state, {
            tracing: {
              skeleton: {
                activeNodeId: { $set: null },
                activeTreeId: { $set: null },
                activeGroupId: { $set: action.groupId },
              },
            },
          });
        }

        case "DESELECT_ACTIVE_GROUP": {
          return update(state, {
            tracing: {
              skeleton: {
                activeGroupId: { $set: null },
              },
            },
          });
        }

        case "SELECT_NEXT_TREE": {
          const { activeTreeId, trees } = skeletonTracing;
          if (_.values(trees).length === 0) return state;

          const increaseDecrease = action.forward ? 1 : -1;

          const orderAttribute = state.userConfiguration.sortTreesByName ? "name" : "timestamp";
          const treeIds = _.orderBy(_.values(trees), [orderAttribute]).map(t => t.treeId);

          // default to the first tree
          const activeTreeIdIndex = activeTreeId != null ? treeIds.indexOf(activeTreeId) : 0;

          // treeIds.length is taken into account in this calculation, because -1 % n == -1
          const newActiveTreeIdIndex =
            (activeTreeIdIndex + increaseDecrease + treeIds.length) % treeIds.length;

          const newActiveTreeId = treeIds[newActiveTreeIdIndex];
          const newActiveNodeId = _.max(trees[newActiveTreeId].nodes.map(el => el.id)) || null;

          return update(state, {
            tracing: {
              skeleton: {
                activeTreeId: { $set: newActiveTreeId },
                activeNodeId: { $set: newActiveNodeId },
                activeGroupId: { $set: null },
              },
            },
          });
        }

        case "SET_TREE_COLOR_INDEX": {
          const { colorIndex } = action;
          return getTree(skeletonTracing, action.treeId)
            .chain(tree => setTreeColorIndex(skeletonTracing, tree, colorIndex))
            .map(([tree, treeId]) =>
              update(state, {
                tracing: { skeleton: { trees: { [treeId]: { $set: tree } } } },
              }),
            )
            .getOrElse(state);
        }

        case "SET_TREE_COLOR": {
          const { color, treeId } = action;
          return getTree(skeletonTracing, treeId)
            .map(tree =>
              update(state, {
                tracing: { skeleton: { trees: { [tree.treeId]: { color: { $set: color } } } } },
              }),
            )
            .getOrElse(state);
        }

        case "SHUFFLE_TREE_COLOR": {
          return getTree(skeletonTracing, action.treeId)
            .chain(tree => shuffleTreeColor(skeletonTracing, tree))
            .map(([tree, treeId]) =>
              update(state, {
                tracing: { skeleton: { trees: { [treeId]: { $set: tree } } } },
              }),
            )
            .getOrElse(state);
        }

        case "SHUFFLE_ALL_TREE_COLORS": {
          const newColors = ColorGenerator.getNRandomColors(_.size(skeletonTracing.trees));
          return update(state, {
            tracing: {
              skeleton: {
                trees: {
                  $apply: oldTrees =>
                    _.mapValues(oldTrees, tree =>
                      update(tree, {
                        color: { $set: newColors.shift() },
                      }),
                    ),
                },
              },
            },
          });
        }

        case "SET_TRACING": {
          return update(state, {
            tracing: {
              skeleton: {
                $set: update(action.tracing, { version: { $set: skeletonTracing.version } }),
              },
            },
          });
        }

        case "TOGGLE_TREE": {
          const { treeId } = action;
          return getTree(skeletonTracing, treeId)
            .map(tree =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: {
                      [tree.treeId]: {
                        isVisible: {
                          $apply: bool => !bool,
                        },
                      },
                    },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "SET_TREE_VISIBILITY": {
          const { treeId, isVisible } = action;
          return getTree(skeletonTracing, treeId)
            .map(tree =>
              update(state, {
                tracing: {
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
              }),
            )
            .getOrElse(state);
        }

        case "TOGGLE_ALL_TREES": {
          return toggleAllTreesReducer(state, skeletonTracing);
        }

        case "TOGGLE_INACTIVE_TREES": {
          const { activeGroupId } = skeletonTracing;
          if (activeGroupId != null) {
            // Toggle all trees
            const toggledTreeState = toggleAllTreesReducer(state, skeletonTracing);
            if (toggledTreeState.tracing.skeleton == null) {
              throw new Error("Satisfy flow");
            }
            // Ensure the active group is visible
            return toggleTreeGroupReducer(
              toggledTreeState,
              toggledTreeState.tracing.skeleton,
              activeGroupId,
              true,
            );
          }

          return getTree(skeletonTracing)
            .map(activeTree =>
              update(toggleAllTreesReducer(state, skeletonTracing), {
                tracing: {
                  skeleton: {
                    trees: {
                      [activeTree.treeId]: {
                        isVisible: { $set: true },
                      },
                    },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "TOGGLE_TREE_GROUP": {
          return toggleTreeGroupReducer(state, skeletonTracing, action.groupId);
        }

        case "UPDATE_NAVIGATION_LIST": {
          const { list, activeIndex } = action;

          return update(state, {
            tracing: {
              skeleton: {
                navigationList: {
                  list: {
                    $set: list,
                  },
                  activeIndex: { $set: activeIndex },
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

        default:
        // pass
      }

      /**
       * ATTENTION: The following actions are only executed if allowUpdate is true!
       */

      const { restrictions } = state.tracing;
      const { allowUpdate } = restrictions;
      if (!allowUpdate) return state;

      switch (action.type) {
        case "CREATE_NODE": {
          const { position, rotation, viewport, resolution, treeId, timestamp } = action;

          return getOrCreateTree(state, skeletonTracing, treeId, timestamp)
            .chain(tree =>
              createNode(
                state,
                skeletonTracing,
                tree,
                position,
                rotation,
                viewport,
                resolution,
                timestamp,
              ).map(([node, edges]) => {
                const diffableNodeMap = tree.nodes;
                const newDiffableMap = diffableNodeMap.set(node.id, node);
                const newTree = update(tree, {
                  nodes: { $set: newDiffableMap },
                  edges: { $set: edges },
                });
                const activeNodeId = action.dontActivate ? skeletonTracing.activeNodeId : node.id;
                const activeTreeId = action.dontActivate
                  ? skeletonTracing.activeTreeId
                  : tree.treeId;
                return update(state, {
                  tracing: {
                    skeleton: {
                      trees: {
                        [tree.treeId]: { $set: newTree },
                      },
                      activeNodeId: { $set: activeNodeId },
                      activeGroupId: { $set: null },
                      cachedMaxNodeId: { $set: node.id },
                      activeTreeId: { $set: activeTreeId },
                    },
                  },
                });
              }),
            )
            .getOrElse(state);
        }

        case "DELETE_NODE": {
          const { timestamp, nodeId, treeId } = action;
          return getNodeAndTree(skeletonTracing, nodeId, treeId)
            .chain(([tree, node]) => deleteNode(state, tree, node, timestamp))
            .map(([trees, newActiveTreeId, newActiveNodeId, newMaxNodeId]) =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: { $set: trees },
                    activeNodeId: { $set: newActiveNodeId },
                    activeTreeId: { $set: newActiveTreeId },
                    activeGroupId: { $set: null },
                    cachedMaxNodeId: { $set: newMaxNodeId },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "DELETE_EDGE": {
          const { timestamp, sourceNodeId, targetNodeId } = action;

          if (sourceNodeId === targetNodeId) {
            return state;
          }

          const sourceTreeMaybe = getNodeAndTree(skeletonTracing, sourceNodeId);
          const targetTreeMaybe = getNodeAndTree(skeletonTracing, targetNodeId);
          return sourceTreeMaybe
            .chain(([sourceTree, sourceNode]) =>
              targetTreeMaybe.chain(([targetTree, targetNode]) =>
                deleteEdge(state, sourceTree, sourceNode, targetTree, targetNode, timestamp),
              ),
            )
            .map(([trees, newActiveTreeId]) =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: { $set: trees },
                    activeTreeId: { $set: newActiveTreeId },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "SET_NODE_POSITION": {
          const { position, nodeId, treeId } = action;
          return getNodeAndTree(skeletonTracing, nodeId, treeId)
            .map(([tree, node]) => {
              const diffableMap = skeletonTracing.trees[tree.treeId].nodes;
              const newDiffableMap = diffableMap.set(
                node.id,
                update(node, { position: { $set: position } }),
              );
              return update(state, {
                tracing: {
                  skeleton: {
                    trees: {
                      [tree.treeId]: { nodes: { $set: newDiffableMap } },
                    },
                  },
                },
              });
            })
            .getOrElse(state);
        }

        case "CREATE_BRANCHPOINT": {
          const { timestamp, nodeId, treeId } = action;
          return getNodeAndTree(skeletonTracing, nodeId, treeId)
            .chain(([tree, node]) =>
              createBranchPoint(skeletonTracing, tree, node, timestamp, restrictions).map(
                branchPoint =>
                  update(state, {
                    tracing: {
                      skeleton: {
                        trees: { [tree.treeId]: { branchPoints: { $push: [branchPoint] } } },
                      },
                    },
                  }),
              ),
            )
            .getOrElse(state);
        }

        case "DELETE_BRANCHPOINT": {
          return deleteBranchPoint(skeletonTracing, restrictions)
            .map(([branchPoints, treeId, newActiveNodeId]) =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: { [treeId]: { branchPoints: { $set: branchPoints } } },
                    activeNodeId: { $set: newActiveNodeId },
                    activeTreeId: { $set: treeId },
                    activeGroupId: { $set: null },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "DELETE_SELECTED_BRANCHPOINT": {
          const { nodeId, treeId } = action;
          return getTree(skeletonTracing, treeId)
            .map(tree =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: {
                      [treeId]: {
                        branchPoints: {
                          $set: tree.branchPoints.filter(bp => bp.nodeId !== nodeId),
                        },
                      },
                    },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "CREATE_TREE": {
          const { timestamp } = action;
          return createTree(state, timestamp)
            .map(tree =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: { [tree.treeId]: { $set: tree } },
                    activeNodeId: { $set: null },
                    activeTreeId: { $set: tree.treeId },
                    activeGroupId: { $set: null },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "ADD_TREES_AND_GROUPS": {
          const { trees, treeGroups } = action;
          const treesWithNames = ensureTreeNames(state, trees);
          return addTreesAndGroups(skeletonTracing, treesWithNames, treeGroups)
            .map(([updatedTrees, updatedTreeGroups, newMaxNodeId]) =>
              update(state, {
                tracing: {
                  skeleton: {
                    treeGroups: { $push: updatedTreeGroups },
                    trees: { $merge: updatedTrees },
                    cachedMaxNodeId: { $set: newMaxNodeId },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "DELETE_TREE": {
          const { treeId } = action;
          return getTree(skeletonTracing, treeId)
            .chain(tree => deleteTree(skeletonTracing, tree))
            .map(([trees, newActiveTreeId, newActiveNodeId, newMaxNodeId]) =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: { $set: trees },
                    activeTreeId: { $set: newActiveTreeId },
                    activeNodeId: { $set: newActiveNodeId },
                    activeGroupId: { $set: null },
                    cachedMaxNodeId: { $set: newMaxNodeId },
                  },
                },
              }),
            )
            .getOrElse(state);
        }
        case "RESET_SKELETON_TRACING": {
          const newTree = createTree(state, Date.now(), false).get();
          const newTreesObject = Object.assign({}, { [newTree.treeId]: newTree });
          const newState = update(state, {
            tracing: {
              skeleton: {
                trees: { $set: newTreesObject },
                activeTreeId: { $set: newTree.treeId },
                activeNodeId: { $set: null },
                activeGroupId: { $set: null },
                treeGroups: { $set: [] },
              },
            },
          });
          return newState;
        }

        case "MERGE_TREES": {
          const { sourceNodeId, targetNodeId } = action;
          return mergeTrees(skeletonTracing, sourceNodeId, targetNodeId)
            .map(([trees, newActiveTreeId, newActiveNodeId]) =>
              update(state, {
                tracing: {
                  skeleton: {
                    trees: { $set: trees },
                    activeNodeId: { $set: newActiveNodeId },
                    activeTreeId: { $set: newActiveTreeId },
                    activeGroupId: { $set: null },
                  },
                },
              }),
            )
            .getOrElse(state);
        }

        case "SET_TREE_NAME": {
          return getTree(skeletonTracing, action.treeId)
            .map(tree => {
              const defaultName = `Tree${Utils.zeroPad(tree.treeId, 3)}`;
              const newName = action.name || defaultName;
              return update(state, {
                tracing: {
                  skeleton: { trees: { [tree.treeId]: { name: { $set: newName } } } },
                },
              });
            })
            .getOrElse(state);
        }

        case "CREATE_COMMENT": {
          const { commentText, nodeId, treeId } = action;
          return getNodeAndTree(skeletonTracing, nodeId, treeId)
            .chain(([tree, node]) =>
              createComment(skeletonTracing, tree, node, commentText).map(comments =>
                update(state, {
                  tracing: {
                    skeleton: {
                      trees: { [tree.treeId]: { comments: { $set: comments } } },
                    },
                  },
                }),
              ),
            )
            .getOrElse(state);
        }

        case "DELETE_COMMENT": {
          return getNodeAndTree(skeletonTracing, action.nodeId, action.treeId)
            .chain(([tree, node]) =>
              deleteComment(skeletonTracing, tree, node).map(comments =>
                update(state, {
                  tracing: {
                    skeleton: {
                      trees: { [tree.treeId]: { comments: { $set: comments } } },
                    },
                  },
                }),
              ),
            )
            .getOrElse(state);
        }

        case "SET_TREE_GROUPS": {
          const { treeGroups } = action;
          const updatedTrees = removeMissingGroupsFromTrees(skeletonTracing, treeGroups);
          return update(state, {
            tracing: {
              skeleton: {
                treeGroups: {
                  $set: action.treeGroups,
                },
                trees: { $merge: updatedTrees },
              },
            },
          });
        }

        case "SET_TREE_GROUP": {
          const { treeId, groupId } = action;
          return getTree(skeletonTracing, treeId)
            .map(tree =>
              update(state, {
                tracing: {
                  skeleton: { trees: { [tree.treeId]: { groupId: { $set: groupId } } } },
                },
              }),
            )
            .getOrElse(state);
        }

        default:
          return state;
      }
    })
    .getOrElse(state);
}

export default SkeletonTracingReducer;
