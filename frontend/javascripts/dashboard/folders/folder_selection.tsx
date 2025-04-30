import { TreeSelect } from "antd";
import _ from "lodash";
import { useEffect, useState } from "react";

import { useFolderHierarchyQuery } from "dashboard/dataset/queries";
import type { FolderItem } from "types/api_types";

function addDisabledProperty(tree: FolderItem[]) {
  const newTree = _.cloneDeep(tree);

  function traverse(element: FolderItem) {
    if (Array.isArray(element.children)) {
      element.children.forEach(traverse);
    }
    if (typeof element.isEditable === "boolean") {
      element.disabled = !element.isEditable;
    }
  }

  newTree.forEach(traverse);

  return newTree;
}

export default function FolderSelection({
  folderId,
  onChange,
  width,
  disabled,
  disableNotEditableFolders,
}: {
  folderId?: string | null;
  onChange?: (id: string | null) => void;
  width?: string | number | null;
  disabled?: boolean;
  disableNotEditableFolders?: boolean;
}) {
  const [treeData, setTreeData] = useState<FolderItem[]>([]);
  const { data: hierarchy } = useFolderHierarchyQuery();

  useEffect(() => {
    if (hierarchy) {
      const newTree = disableNotEditableFolders
        ? addDisabledProperty(hierarchy.tree)
        : hierarchy.tree;
      setTreeData(newTree);
    } else {
      setTreeData([]);
    }
  }, [hierarchy, disableNotEditableFolders]);

  return (
    <TreeSelect
      disabled={disabled || false}
      showSearch
      style={{ width: width || "100%" }}
      value={folderId || undefined}
      dropdownStyle={{ maxHeight: 500, overflow: "auto" }}
      placeholder="Select Folder"
      treeNodeFilterProp={"title"}
      allowClear
      popupMatchSelectWidth={false}
      treeDefaultExpandAll
      onChange={onChange}
      treeData={treeData}
      fieldNames={{ label: "title", value: "key", children: "children" }}
      treeNodeLabelProp="title"
    />
  );
}
