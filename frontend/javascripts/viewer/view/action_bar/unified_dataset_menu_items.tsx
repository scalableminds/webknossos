// Dataset entries of the viewer menu in the unified datasets prototype (features.unifiedDatasets).
import { CopyOutlined, SettingOutlined } from "@ant-design/icons";
import type { ItemType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import { Link } from "react-router";
import { isUnifiedDatasetView } from "viewer/model/accessors/unified_dataset_accessor";
import { setCopyDatasetModalVisibilityAction } from "viewer/model/actions/ui_actions";
import Store from "viewer/store";

export function useUnifiedDatasetMenuItems(): ItemType[] {
  const isUnified = useWkSelector(isUnifiedDatasetView);
  const datasetId = useWkSelector((state) => state.dataset.id);
  const isDatasetEditable = useWkSelector((state) => state.dataset.isEditable);
  const isLoggedIn = useWkSelector((state) => state.activeUser != null);

  return useMemo(() => {
    if (!isUnified) {
      return [];
    }
    const items: ItemType[] = [];
    if (isLoggedIn) {
      items.push({
        key: "copy-dataset-button",
        icon: <CopyOutlined />,
        label: "Copy dataset…",
        onClick: () => Store.dispatch(setCopyDatasetModalVisibilityAction(true)),
      });
    }
    if (isDatasetEditable) {
      items.push({
        key: "dataset-settings-button",
        icon: <SettingOutlined />,
        label: <Link to={`/datasets/${datasetId}/edit`}>Dataset settings</Link>,
      });
    }
    return items;
  }, [isUnified, datasetId, isDatasetEditable, isLoggedIn]);
}
