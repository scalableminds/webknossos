import { FolderOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Button, Card, Flex } from "antd";
import features, { getDemoDatasetUrl } from "features";
import { filterNullValues, isUserAdminOrDatasetManager } from "libs/utils";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { APIDatasetCompact, APIUser, FolderItem } from "types/api_types";
import DatasetCollectionContextProvider, {
  useDatasetCollectionContext,
} from "./dataset/dataset_collection_context";
import { useDatasetsInFolderQuery, useFolderHierarchyQuery } from "./dataset/queries";
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
  const isCompact = useIsCompactDashboard();
  const [isFolderDrawerOpen, setIsFolderDrawerOpen] = useState(false);
  const [isDetailsDrawerOpen, setIsDetailsDrawerOpen] = useState(false);

  // On compact screens, close the folder drawer once another folder was opened in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only react to folder changes.
  useEffect(() => {
    setIsFolderDrawerOpen(false);
  }, [context.activeFolderId]);

  const setSelectedDataset = (ds: APIDatasetCompact | null, multiSelect?: boolean) => {
    if (!ds) {
      setSelectedDatasets([]);
      return;
    }
    if (isCompact) {
      // On compact screens, the details aren't visible next to the list. Tapping a dataset
      // shows them in a drawer and always selects it (instead of toggling the selection).
      setSelectedDatasets([ds]);
      context.setSelectedFolder(null);
      setIsDetailsDrawerOpen(true);
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
    if (folder?.key === context.selectedFolder?.key) {
      context.setSelectedFolder(null);
      return;
    }
    context.setSelectedFolder(folder);
  };
  const { data: selectedFolderDatasets } = useDatasetsInFolderQuery(
    context.selectedFolder?.key || null,
  );
  const folderIdForDetailsSidebar = context.selectedFolder?.key ?? context.activeFolderId;
  const datasetCountForDetailsSidebar =
    context.selectedFolder != null ? selectedFolderDatasets?.length || 0 : context.datasets.length;

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
    const cardContainerStyle = { width: 340, maxWidth: "100%" };
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
                ,
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
          padding: "20px 50px 70px",
        }}
      >
        {features().isWkorgInstance ? openPublicDatasetCard : null}
        {isUserAdminOrDatasetManager(props.user) ? uploadPlaceholderCard : null}
      </Flex>
    );
  };

  const isBrandNewEmptyOrg =
    hierarchy != null &&
    hierarchy.flatItems.length === 1 &&
    context.datasets.length === 0 &&
    context.activeFolderId != null &&
    !context.isLoading &&
    context.globalSearchQuery == null;

  const folderModal = folderModalState != null && (
    <FolderModal {...folderModalState} onClose={() => setFolderModalState(null)} />
  );
  const folderTree = (
    <ResponsiveSidebar
      isCompact={isCompact}
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
    />
  );
  const detailsSidebar = (
    <ResponsiveSidebar
      isCompact={isCompact}
      isOpen={isDetailsDrawerOpen}
      onClose={() => setIsDetailsDrawerOpen(false)}
      title="Details"
      placement="right"
    >
      <DetailsSidebar
        selectedDatasets={selectedDatasets}
        setSelectedDataset={setSelectedDataset}
        folderId={folderIdForDetailsSidebar}
        datasetCount={datasetCountForDetailsSidebar}
        searchQuery={context.globalSearchQuery}
        displayedFolderEqualsActiveFolder={context.selectedFolder == null}
      />
    </ResponsiveSidebar>
  );

  if (isCompact) {
    return (
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        {folderModal}
        <Flex gap="small" style={{ marginBottom: 12 }}>
          <Button icon={<FolderOutlined />} onClick={() => setIsFolderDrawerOpen(true)}>
            Folders
          </Button>
          <Button icon={<InfoCircleOutlined />} onClick={() => setIsDetailsDrawerOpen(true)}>
            Details
          </Button>
        </Flex>
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
        gridTemplate:
          "auto / auto minmax(min(40%, var(--dashboard-list-max-width)), var(--dashboard-list-max-width)) auto",
        justifyContent: "center",
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {folderModal}
      <div
        style={{
          gridColumn: "1 / 2",
          overflow: "auto",
          marginRight: 16,
        }}
      >
        {folderTree}
      </div>
      <main
        style={{
          gridColumn: "2 / 3",
          paddingRight: 4,
        }}
      >
        {datasetView}
      </main>
      <div
        style={{
          gridColumn: "3 / 4",
          marginLeft: 4,
        }}
      >
        {detailsSidebar}
      </div>
    </div>
  );
}
