import { type Key, useCallback, useState } from "react";
import { getTreeNodeKey, type TreeRowNode } from "../comment_tab_types";

export function useExpandedTreeKeys(treeNodes: TreeRowNode[]) {
  // All trees start out expanded. Trees created afterwards keep their collapse state.
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(() => treeNodes.map((node) => node.key));

  const expandTree = useCallback((treeId: number) => {
    const treeKey = getTreeNodeKey(treeId);
    // Returning the unchanged array lets React bail out of the state update.
    setExpandedKeys((keys) => (keys.includes(treeKey) ? keys : [...keys, treeKey]));
  }, []);

  const toggleExpandAll = useCallback(() => {
    setExpandedKeys((keys) => (keys.length > 0 ? [] : treeNodes.map((node) => node.key)));
  }, [treeNodes]);

  return { expandedKeys, setExpandedKeys, expandTree, toggleExpandAll };
}
