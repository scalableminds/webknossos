import { DownOutlined, FolderOutlined } from "@ant-design/icons";
import { Button, Card, Flex } from "antd";
import features, { getDemoDatasetUrl } from "features";
import { filterNullValues, isUserAdminOrDatasetManager } from "libs/utils";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { APIDatasetCompact, APIUser, FolderItem } from "types/api_types";
import DatasetCollectionContextProvider, {
  useDatasetCollectionContext,
} from "./dataset/dataset_collection_context";
import { useDoesFolderContainDatasetsQuery, useFolderHierarchyQuery } from "./dataset/queries";
import DatasetView from "./dataset_view";
import { DetailsSidebar } from "./folders/details_sidebar";
import { FolderModal } from "./folders/folder_modal";
import { FolderTreeSidebar } from "./folders/folder_tree";
import { ResponsiveSidebar, useIsCompactDashboard } from "./responsive_sidebar";

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
  const { selectedDatasets, setSelectedDatasets, folderModalState, setFolderModalState } = context;
  const { data: hierarchy } = useFolderHierarchyQuery();
  // The folder tree moves into a drawer first. The details sidebar follows once space is even tighter.
  const isFolderTreeCompact = useIsCompactDashboard("xl");
  const isDetailsCompact = useIsCompactDashboard("md");
  const [isFolderDrawerOpen, setIsFolderDrawerOpen] = useState(false);
  const [isDetailsDrawerOpen, setIsDetailsDrawerOpen] = useState(false);

  // On compact screens, close the folder drawer once another folder was opened in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only react to folder changes.
  useEffect(() => {
    setIsFolderDrawerOpen(false);
  }, [context.activeFolderId]);

  // Once a sidebar is shown inline again, close its drawer. Otherwise, it would reappear when the
  // window gets narrow again, without the user having opened it.
  useEffect(() => {
    if (!isFolderTreeCompact) setIsFolderDrawerOpen(false);
  }, [isFolderTreeCompact]);
  useEffect(() => {
    if (!isDetailsCompact) setIsDetailsDrawerOpen(false);
  }, [isDetailsCompact]);

  const setSelectedDataset = (
    ds: APIDatasetCompact | null,
    multiSelect?: boolean,
    isDragStart?: boolean,
  ) => {
    if (!ds) {
      setSelectedDatasets([]);
      return;
    }
    if (isDetailsCompact) {
      // On compact screens, the details aren't visible next to the list. Tapping a dataset
      // shows them in a drawer and always selects it (instead of toggling the selection).
      setSelectedDatasets([ds]);
      context.setSelectedFolder(null);
      // The drawer's mask would cover the folder rows that the dataset could be dropped on.
      if (!isDragStart) {
        setIsDetailsDrawerOpen(true);
      }
      return;
    }
    // Clear folder selection if a dataset is selected.
    context.setSelectedFolder(null);

    setSelectedDatasets((oldSelectedDatasets) => {
      const set = new Set(oldSelectedDatasets);

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
      return Array.from(set);
    });
  };

  const setSelectedFolder = (folder: FolderItem | null) => {
    if (folder) {
      setSelectedDatasets([]);
    }
    if (isDetailsCompact && folder) {
      // Same as for datasets: show the details in a drawer and always select the folder.
      context.setSelectedFolder(folder);
      setIsDetailsDrawerOpen(true);
      return;
    }
    if (folder?.key === context.selectedFolder?.key) {
      context.setSelectedFolder(null);
      return;
    }
    context.setSelectedFolder(folder);
  };
  const { data: doesSelectedFolderContainDatasets = false } = useDoesFolderContainDatasetsQuery(
    context.selectedFolder?.key || null,
    context.datasetListParams,
  );
  const folderIdForDetailsSidebar = context.selectedFolder?.key ?? context.activeFolderId;
  const doesFolderContainDatasetsForDetailsSidebar =
    context.selectedFolder != null
      ? doesSelectedFolderContainDatasets
      : context.datasets.length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Only update the selected datasets when the context datasets change.
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

  const renderNoDatasetsPlaceHolder = () => {
    // A shrinkable flex basis instead of a fixed width: the cards sit in a table cell, which would
    // grow to fit a fixed width (and overflow on phones) instead of applying the max width.
    const cardContainerStyle = { flex: "0 1 340px", minWidth: 0 };
    const openPublicDatasetCard = (
      <div style={cardContainerStyle}>
        <Card
          variant="borderless"
          cover={<i className="drawing drawing-empty-list-public-gallery" />}
        >
          <Card.Meta
            title="Open a Demo Dataset"
            description={
              <>
                <p>Check out a published community dataset to experience WEBKNOSSOS in action.</p>
                <a href={getDemoDatasetUrl()} target="_blank" rel="noopener noreferrer">
                  <Button style={{ marginTop: 30 }}>Open a Community Dataset</Button>
                </a>
              </>
            }
          />
        </Card>
      </div>
    );

    const uploadPlaceholderCard = (
      <div style={cardContainerStyle}>
        <Card
          variant="borderless"
          cover={
            <Flex justify="center">
              <i className="drawing drawing-empty-list-dataset-upload" />
            </Flex>
          }
          style={{ background: "transparent" }}
        >
          <Card.Meta
            title="Upload & Import Dataset"
            style={{ textAlign: "center" }}
            description={
              <>
                <p>
                  WEBKNOSSOS supports a variety of (remote){" "}
                  <a
                    href="https://docs.webknossos.org/webknossos/data/index.html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    file formats
                  </a>{" "}
                  and is also able to convert them when necessary.
                </p>
                <Link to="/datasets/upload">
                  <Button type="primary" style={{ marginTop: 30 }}>
                    Open Dataset Upload & Import
                  </Button>
                </Link>
              </>
            }
          />
        </Card>
      </div>
    );

    return (
      <Flex
        wrap
        justify="center"
        align="center"
        gap={32}
        style={{
          // No side padding, so that the cards keep their full width on phones.
          padding: "20px 0 70px",
        }}
      >
        {features().isWkorgInstance ? openPublicDatasetCard : null}
        {isUserAdminOrDatasetManager(props.user) ? uploadPlaceholderCard : null}
      </Flex>
    );
  };

  const activeFolderTitle =
    context.activeFolderId != null ? hierarchy?.itemById[context.activeFolderId]?.title : undefined;

  const mightBeBrandNewEmptyOrg =
    hierarchy != null &&
    hierarchy.flatItems.length === 1 &&
    context.datasets.length === 0 &&
    context.activeFolderId != null &&
    !context.isLoading &&
    context.globalSearchQuery == null;
  // The listed datasets are filtered (e.g., unreported ones are hidden by default), so check
  // whether the folder contains any dataset at all.
  const { data: doesRootFolderContainAnyDatasets } = useDoesFolderContainDatasetsQuery(
    context.activeFolderId,
    {},
    mightBeBrandNewEmptyOrg,
  );
  const isBrandNewEmptyOrg = mightBeBrandNewEmptyOrg && doesRootFolderContainAnyDatasets === false;

  const folderModal = folderModalState != null && (
    <FolderModal {...folderModalState} onClose={() => setFolderModalState(null)} />
  );
  const folderTree = (
    <ResponsiveSidebar
      isCompact={isFolderTreeCompact}
      isOpen={isFolderDrawerOpen}
      onClose={() => setIsFolderDrawerOpen(false)}
      title="Folders"
      placement="left"
    >
      <FolderTreeSidebar />
    </ResponsiveSidebar>
  );
  const datasetView = (
    <DatasetView
      user={props.user}
      onSelectDataset={setSelectedDataset}
      onSelectFolder={setSelectedFolder}
      selectedDatasets={selectedDatasets}
      context={context}
      emptyStateContent={isBrandNewEmptyOrg ? renderNoDatasetsPlaceHolder() : undefined}
      folderPicker={
        isFolderTreeCompact ? (
          // Shows the current location, like a picker, so that it's clear that tapping it lets
          // the user change the folder. The details drawer opens when tapping a list entry.
          <Button
            icon={<FolderOutlined />}
            onClick={() => setIsFolderDrawerOpen(true)}
            style={{ maxWidth: "100%" }}
          >
            <span className="dashboard-folder-picker-label">{activeFolderTitle ?? "Folders"}</span>
            <DownOutlined />
          </Button>
        ) : undefined
      }
    />
  );
  const detailsSidebar = (
    <ResponsiveSidebar
      isCompact={isDetailsCompact}
      isOpen={isDetailsDrawerOpen}
      onClose={() => setIsDetailsDrawerOpen(false)}
      title="Details"
      placement="right"
    >
      <DetailsSidebar
        selectedDatasets={selectedDatasets}
        setSelectedDataset={setSelectedDataset}
        folderId={folderIdForDetailsSidebar}
        datasetCount={context.datasets.length}
        doesFolderContainDatasets={doesFolderContainDatasetsForDetailsSidebar}
        searchQuery={context.globalSearchQuery}
        displayedFolderEqualsActiveFolder={context.selectedFolder == null}
      />
    </ResponsiveSidebar>
  );

  if (isDetailsCompact) {
    return (
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        {folderModal}
        {folderTree}
        <main>{datasetView}</main>
        {detailsSidebar}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplate: isFolderTreeCompact
          ? "auto / minmax(0, var(--dashboard-list-max-width)) auto"
          : "auto / auto minmax(min(40%, var(--dashboard-list-max-width)), var(--dashboard-list-max-width)) auto",
        justifyContent: "center",
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {folderModal}
      {isFolderTreeCompact ? (
        // Renders a drawer, which doesn't take up a grid cell.
        folderTree
      ) : (
        <div
          style={{
            overflow: "auto",
            marginRight: 16,
          }}
        >
          {folderTree}
        </div>
      )}
      <main
        style={{
          paddingRight: 4,
          minWidth: 0,
        }}
      >
        {datasetView}
      </main>
      <div
        style={{
          marginLeft: 4,
        }}
      >
        {detailsSidebar}
      </div>
    </div>
  );
}
