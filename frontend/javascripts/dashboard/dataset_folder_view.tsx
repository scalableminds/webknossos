import { filterNullValues } from "libs/utils";
import React, { useEffect, useState } from "react";
import { APIMaybeUnimportedDataset, APIUser } from "types/api_flow_types";
import DatasetCollectionContextProvider, {
  useDatasetCollectionContext,
} from "./dataset/dataset_collection_context";

import DatasetView from "./dataset_view";
import { DetailsSidebar } from "./folders/details_sidebar";
import { EditFolderModal } from "./folders/edit_folder_modal";
import { FolderTreeSidebar } from "./folders/folder_tree";

type Props = {
  user: APIUser;
};

export function DatasetFolderView(props: Props) {
  return (
    <DatasetCollectionContextProvider>
      <DatasetFolderViewInner {...props} />
    </DatasetCollectionContextProvider>
  );
}

function DatasetFolderViewInner(props: Props) {
  const context = useDatasetCollectionContext();
  const { selectedDatasets, setSelectedDatasets } = context;
  const [folderIdForEditModal, setFolderIdForEditModal] = useState<string | null>(null);

  const setSelectedDataset = (ds: APIMaybeUnimportedDataset | null, multiSelect?: boolean) => {
    if (!ds) {
      setSelectedDatasets([]);
      return;
    }
    const set = new Set(selectedDatasets);

    if (multiSelect) {
      if (set.has(ds)) {
        set.delete(ds);
      } else {
        set.add(ds);
      }
    } else {
      if (set.has(ds) && set.size === 1) {
        set.clear();
      } else {
        set.clear();
        set.add(ds);
      }
    }

    setSelectedDatasets(Array.from(set));
  };

  useEffect(() => {
    if (selectedDatasets.length === 0 || !context.datasets) {
      return;
    }
    // If the cache changed (e.g., because a dataset was updated), we need to update
    // the selectedDataset instance, too, to avoid that it refers to stale data.
    setSelectedDatasets(
      filterNullValues(
        selectedDatasets.map(
          (selectedDataset) =>
            context.datasets.find((ds) => ds.name === selectedDataset.name) ?? null,
        ),
      ),
    );
  }, [context.datasets]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplate: "auto / auto 1fr auto",
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {folderIdForEditModal != null && (
        <EditFolderModal
          onClose={() => setFolderIdForEditModal(null)}
          folderId={folderIdForEditModal}
        />
      )}
      <div
        style={{
          gridColumn: "1 / 2",
          overflow: "auto",
          borderRight: "1px solid var(--ant-border-base)",
          marginRight: 16,
        }}
      >
        <FolderTreeSidebar setFolderIdForEditModal={setFolderIdForEditModal} />
      </div>
      <main style={{ gridColumn: "2 / 2", overflow: "auto", paddingRight: 4 }}>
        <DatasetView
          user={props.user}
          onSelectDataset={setSelectedDataset}
          selectedDatasets={selectedDatasets}
          context={context}
          hideDetailsColumns
        />
      </main>
      <div
        style={{
          gridColumn: "3 / 4",
          overflow: "auto",
          borderLeft: "1px solid var(--ant-border-base)",
          marginLeft: 4,
        }}
      >
        <DetailsSidebar
          selectedDatasets={selectedDatasets}
          setSelectedDataset={setSelectedDataset}
          activeFolderId={context.activeFolderId}
          datasetCount={context.datasets.length}
          setFolderIdForEditModal={setFolderIdForEditModal}
          searchQuery={context.globalSearchQuery}
        />
      </div>
    </div>
  );
}
