import { TreeSelect } from "antd";
import React from "react";

import { useFolderHierarchyQuery } from "dashboard/dataset/queries";

export default function FolderSelection({
  folderId,
  onChange,
}: {
  folderId: string | null;
  onChange: (id: string | null) => void;
}) {
  const { data: hierarchy } = useFolderHierarchyQuery();

  return (
    <TreeSelect
      showSearch
      style={{ width: 150 }}
      value={folderId || undefined}
      dropdownStyle={{ maxHeight: 500, overflow: "auto" }}
      placeholder="Select Folder"
      allowClear
      dropdownMatchSelectWidth={false}
      treeDefaultExpandAll
      onChange={onChange}
      treeData={hierarchy?.tree || []}
      fieldNames={{ label: "title", value: "key", children: "children" }}
      treeNodeLabelProp="title"
    />
  );
}
