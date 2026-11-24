import { type Key, useState } from "react";

/*
 * Keeps antd's keyboard cursor (the tree's "active" node) on the selected node, so that there is
 * only one kind of selection (the one that a click creates).
 *
 * The cursor is moved to the selected node whenever the selection changes, but otherwise follows
 * the tree: it clears its cursor when the mouse moves over a row or when the list loses focus.
 * Passing the selected key as a fixed activeKey would fight that. The tree would restore the
 * cursor right away and scroll back to it, so that one could not scroll away from the selected
 * segment while moving the mouse over the list.
 */
export function useTreeCursorOnSelection(selectedKey: string | null) {
  const [activeKey, setActiveKey] = useState<Key | null>(selectedKey);
  const [previousSelectedKey, setPreviousSelectedKey] = useState(selectedKey);
  if (selectedKey !== previousSelectedKey) {
    setPreviousSelectedKey(selectedKey);
    setActiveKey(selectedKey);
  }
  return { activeKey, onActiveChange: setActiveKey };
}
