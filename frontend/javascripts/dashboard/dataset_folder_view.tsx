import { Button, Card, Flex } from "antd";
import features, { getDemoDatasetUrl } from "features";
import { filterNullValues, isUserAdminOrDatasetManager } from "libs/utils";
import { useEffect } from "react";
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

  const setSelectedDataset = (ds: APIDatasetCompact | null, multiSelect?: boolean) => {
    if (!ds) {
      setSelectedDatasets([]);
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
    // A plain width (rather than antd's Row/Col, whose breakpoints react to the
    // viewport width, not this column's actual - narrower, sidebar-squeezed - width)
    // so the cards shrink and wrap based on the space they actually have.
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

  return (
    <div
      style={{
        display: "grid",
        gridTemplate: "auto / auto minmax(60%, 1fr) auto",
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {folderModalState != null && (
        <FolderModal {...folderModalState} onClose={() => setFolderModalState(null)} />
      )}
      <div
        style={{
          gridColumn: "1 / 2",
          overflow: "auto",
          marginRight: 16,
        }}
      >
        <FolderTreeSidebar />
      </div>
      <main
        style={{
          gridColumn: "2 / 3",
          paddingRight: 4,
        }}
      >
        <DatasetView
          user={props.user}
          onSelectDataset={setSelectedDataset}
          onSelectFolder={setSelectedFolder}
          selectedDatasets={selectedDatasets}
          context={context}
          emptyStateContent={isBrandNewEmptyOrg ? renderNoDatasetsPlaceHolder() : undefined}
        />
      </main>
      <div
        style={{
          gridColumn: "3 / 4",
          marginLeft: 4,
        }}
      >
        <DetailsSidebar
          selectedDatasets={selectedDatasets}
          setSelectedDataset={setSelectedDataset}
          folderId={folderIdForDetailsSidebar}
          datasetCount={datasetCountForDetailsSidebar}
          searchQuery={context.globalSearchQuery}
          displayedFolderEqualsActiveFolder={context.selectedFolder == null}
        />
      </div>
    </div>
  );
}
