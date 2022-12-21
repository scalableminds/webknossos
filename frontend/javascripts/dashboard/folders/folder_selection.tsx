import { TreeSelect } from "antd";
import React from "react";

import { useFolderHierarchyQuery } from "dashboard/dataset/queries";

export default function FolderSelection({
  folderId,
  onChange,
  width,
  disabled,
}: {
  folderId: string | null;
  onChange: (id: string | null) => void;
  width?: string | number | null;
  disabled?: boolean;
}) {
  const { data: hierarchy } = useFolderHierarchyQuery();

  return (
    <TreeSelect
      disabled={disabled || false}
      showSearch
      style={{ width: width || "100%" }}
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
