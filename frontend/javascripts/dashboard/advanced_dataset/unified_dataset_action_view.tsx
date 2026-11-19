// Unified datasets prototype (features.unifiedDatasets): the actions of a dataset list row. They
// replace the annotation actions (new/resume annotation) with copying the dataset.
import { CopyOutlined, EllipsisOutlined, EyeOutlined, SettingOutlined } from "@ant-design/icons";
import CopyDatasetModal from "admin/dataset/copy_dataset_modal";
import { App, Dropdown } from "antd";
import { useDatasetCollectionContext } from "dashboard/dataset/dataset_collection_context";
import noop from "lodash-es/noop";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { APIDatasetCompact } from "types/api_types";
import { getReadableURLPart, getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { getDatasetActionContextMenu } from "./dataset_action_view";

function useCopyModalDataset(dataset: APIDatasetCompact) {
  // Memoized, since the modal resets its form whenever this object changes.
  return useMemo(
    () => ({
      id: dataset.id,
      name: dataset.name,
      dataLayerNames: [...dataset.colorLayerNames, ...dataset.segmentationLayerNames],
    }),
    [dataset.id, dataset.name, dataset.colorLayerNames, dataset.segmentationLayerNames],
  );
}

function CopyDatasetAction({
  dataset,
  isCompact,
}: {
  dataset: APIDatasetCompact;
  isCompact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const copyModalDataset = useCopyModalDataset(dataset);
  return (
    <>
      <a onClick={() => setIsOpen(true)} title="Copy Dataset">
        {isCompact ? (
          <CopyOutlined />
        ) : (
          <>
            <CopyOutlined className="icon-margin-right" />
            Copy
          </>
        )}
      </a>
      {isOpen ? (
        // The modal is rendered via a portal, but React still bubbles its events to the table
        // row. Stop them here so that they don't (de)select the row or open its context menu.
        <span
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        >
          <CopyDatasetModal
            dataset={copyModalDataset}
            annotationLayers={dataset.annotationLayers ?? []}
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
          />
        </span>
      ) : null}
    </>
  );
}

function MoreActionsDropdown({ dataset }: { dataset: APIDatasetCompact }) {
  const { modal } = App.useApp();
  const { clearCacheAndReloadDataset } = useDatasetCollectionContext();
  const menu = getDatasetActionContextMenu({
    datasets: [dataset],
    clearCacheAndReloadDataset,
    hideContextMenu: noop,
    modal,
  });
  return (
    <Dropdown menu={menu} trigger={["click"]}>
      <a title="More Actions">
        <EllipsisOutlined />
      </a>
    </Dropdown>
  );
}

export default function UnifiedDatasetActionView({
  dataset,
  isCompact,
}: {
  dataset: APIDatasetCompact;
  // Compact layouts omit the open link (the name already links to the dataset) and the labels.
  isCompact?: boolean;
}) {
  const settingsLink = dataset.isEditable ? (
    <Link to={`/datasets/${getReadableURLPart(dataset)}/edit`} title="Open Dataset Settings">
      {isCompact ? (
        <SettingOutlined />
      ) : (
        <>
          <SettingOutlined className="icon-margin-right" />
          Settings
        </>
      )}
    </Link>
  ) : null;

  return (
    <div className="dataset-table-actions nowrap">
      {isCompact ? null : (
        <Link to={getViewDatasetURL(dataset)} title="Open Dataset">
          <EyeOutlined className="icon-margin-right" />
          Open
        </Link>
      )}
      <CopyDatasetAction dataset={dataset} isCompact={isCompact} />
      {settingsLink}
      <MoreActionsDropdown dataset={dataset} />
    </div>
  );
}
