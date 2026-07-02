import { useEffect, useRef } from "react";
import { getConnectomeDataForLayer } from "viewer/model/accessors/connectome_accessor";
import { getTreeNameForAgglomerateTree } from "viewer/model/accessors/skeletontracing_accessor";
import {
  addConnectomeTreesAction,
  deleteConnectomeTreesAction,
  loadConnectomeAgglomerateTreeAction,
  removeConnectomeAgglomerateTreeAction,
  setConnectomeTreesVisibilityAction,
} from "viewer/model/actions/connectome_actions";
import { type MutableTree, MutableTreeMap } from "viewer/model/types/tree_types";
import Store from "viewer/store";
import {
  type AgglomerateTreeSnapshot,
  computeAgglomerateTreeDiff,
  computeSynapseTreeDiff,
  getMappingNameFromConnectomeData,
  getTreeNameForSynapse,
  synapseNodeCreator,
  synapseTreeCreator,
} from "viewer/view/right_border_tabs/connectome_tab/connectome_data_utils";
import type { ConnectomeData } from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";

// Create a mapping from tree name to tree object that works with DiffableMap
const getTreeNameToTree = (trees: MutableTreeMap): Record<string, MutableTree> => {
  const treeNameToTree: Record<string, MutableTree> = {};
  for (const tree of trees.values()) {
    treeNameToTree[tree.name] = tree;
  }
  return treeNameToTree;
};

// Keeps the synapse trees (single-node trees at the synapse positions) in sync
// with the filtered connectome data by adding/deleting trees as synapses
// appear/disappear.
export function useSynapseTreeSync(
  layerName: string | null | undefined,
  filteredConnectomeData: ConnectomeData | null | undefined,
) {
  const prevFilteredConnectomeDataRef = useRef<ConnectomeData | null | undefined>(null);

  useEffect(() => {
    const prevFilteredConnectomeData = prevFilteredConnectomeDataRef.current;
    prevFilteredConnectomeDataRef.current = filteredConnectomeData;
    if (prevFilteredConnectomeData === filteredConnectomeData) return;
    if (layerName == null) return;

    const { deletedSynapseIds, addedSynapseIds } = computeSynapseTreeDiff(
      prevFilteredConnectomeData,
      filteredConnectomeData,
    );

    const skeleton = getConnectomeDataForLayer(Store.getState(), layerName).skeleton;
    if (skeleton == null) return;
    const treeNameToTree = getTreeNameToTree(skeleton.trees);

    if (deletedSynapseIds.length > 0) {
      const treeIdsToDelete: number[] = [];
      deletedSynapseIds.forEach((synapseId) => {
        const tree = treeNameToTree[getTreeNameForSynapse(synapseId)];

        if (tree != null) {
          treeIdsToDelete.push(tree.treeId);
        }
      });

      if (treeIdsToDelete.length) {
        Store.dispatch(deleteConnectomeTreesAction(treeIdsToDelete, layerName));
      }
    }

    if (addedSynapseIds.length > 0 && filteredConnectomeData != null) {
      const { synapses } = filteredConnectomeData;
      const newTrees = new MutableTreeMap();

      for (const synapseId of addedSynapseIds) {
        const synapseTree = synapseTreeCreator(synapseId, synapses[synapseId].type);
        synapseTree.nodes.mutableSet(
          synapseId,
          synapseNodeCreator(synapseId, synapses[synapseId].position),
        );
        newTrees.mutableSet(synapseId, synapseTree);
      }

      Store.dispatch(addConnectomeTreesAction(newTrees, layerName));
    }
  }, [filteredConnectomeData, layerName]);
}

// Keeps the agglomerate trees in sync with the connectome data and the checked
// state of the synapse tree by loading/removing agglomerate skeletons and toggling
// their visibility.
export function useAgglomerateTreeSync(
  layerName: string | null | undefined,
  connectomeData: ConnectomeData | null | undefined,
  filteredConnectomeData: ConnectomeData | null | undefined,
  checkedKeys: Array<string>,
) {
  const prevRef = useRef<AgglomerateTreeSnapshot>({
    connectomeData: null,
    filteredConnectomeData: null,
    checkedKeys: [],
  });

  useEffect(() => {
    const prev = prevRef.current;
    const current = { connectomeData, filteredConnectomeData, checkedKeys };
    prevRef.current = current;
    if (
      prev.connectomeData === connectomeData &&
      prev.filteredConnectomeData === filteredConnectomeData &&
      prev.checkedKeys === checkedKeys
    ) {
      return;
    }
    if (layerName == null) return;

    const { deletedAgglomerateIds, hiddenAgglomerateIds, addedAgglomerateIds } =
      computeAgglomerateTreeDiff(prev, current);

    if (deletedAgglomerateIds.length) {
      const mappingName = getMappingNameFromConnectomeData(prev.connectomeData);

      for (const agglomerateId of deletedAgglomerateIds) {
        // The check whether these skeleton were actually loaded and need to be removed is done by the saga
        Store.dispatch(
          removeConnectomeAgglomerateTreeAction(layerName, mappingName, agglomerateId),
        );
      }
    }

    const skeleton = getConnectomeDataForLayer(Store.getState(), layerName).skeleton;
    if (skeleton == null) return;
    const treeNameToTree = getTreeNameToTree(skeleton.trees);

    if (hiddenAgglomerateIds.length) {
      const mappingName = getMappingNameFromConnectomeData(prev.connectomeData);

      for (const agglomerateId of hiddenAgglomerateIds) {
        // Hide agglomerates that are no longer visible
        const treeName = getTreeNameForAgglomerateTree(agglomerateId, mappingName);
        const tree = treeNameToTree[treeName];

        if (tree != null) {
          Store.dispatch(setConnectomeTreesVisibilityAction([tree.treeId], false, layerName));
        }
      }
    }

    if (addedAgglomerateIds.length) {
      const mappingName = getMappingNameFromConnectomeData(connectomeData);

      for (const agglomerateId of addedAgglomerateIds) {
        // Show agglomerates that were made visible
        const treeName = getTreeNameForAgglomerateTree(agglomerateId, mappingName);
        const tree = treeNameToTree[treeName];

        // If the tree was already loaded, make it visible, otherwise load it
        if (tree != null) {
          Store.dispatch(setConnectomeTreesVisibilityAction([tree.treeId], true, layerName));
        } else {
          Store.dispatch(
            loadConnectomeAgglomerateTreeAction(layerName, mappingName, agglomerateId),
          );
        }
      }
    }
  }, [connectomeData, filteredConnectomeData, checkedKeys, layerName]);
}
