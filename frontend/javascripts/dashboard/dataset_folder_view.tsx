import { Button, Card, Col, Row } from "antd";
import features, { getDemoDatasetUrl } from "features";
import { filterNullValues } from "libs/utils";
import * as Utils from "libs/utils";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { APIDatasetCompact, APIUser, FolderItem } from "types/api_flow_types";
import DatasetCollectionContextProvider, {
  useDatasetCollectionContext,
} from "./dataset/dataset_collection_context";
import { useDatasetsInFolderQuery, useFolderHierarchyQuery } from "./dataset/queries";
import DatasetView, { DatasetAddButton, DatasetRefreshButton } from "./dataset_view";
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
    const openPublicDatasetCard = (
      <Col span={7}>
        <Card bordered={false} cover={<i className="drawing drawing-empty-list-public-gallery" />}>
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
      </Col>
    );

    const uploadPlaceholderCard = (
      <Col span={7}>
        <Card
          bordered={false}
          cover={
            <div style={{ display: "flex", justifyContent: "center" }}>
              <i className="drawing drawing-empty-list-dataset-upload" />
            </div>
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
      </Col>
    );

    const adminHeader =
      Utils.isUserAdminOrDatasetManager(props.user) || Utils.isUserTeamManager(props.user) ? (
        <div
          className="pull-right"
          style={{
            display: "flex",
          }}
        >
          <DatasetRefreshButton context={context} />
          <DatasetAddButton context={context} />
        </div>
      ) : null;

    return (
      <React.Fragment>
        <RenderToPortal portalId="dashboard-TabBarExtraContent">{adminHeader}</RenderToPortal>
        <Row
          justify="center"
          style={{
            padding: "20px 50px 70px",
          }}
          align="middle"
          gutter={32}
        >
          {features().isWkorgInstance ? openPublicDatasetCard : null}
          {Utils.isUserAdminOrDatasetManager(props.user) ? uploadPlaceholderCard : null}
        </Row>
      </React.Fragment>
    );
  };

  if (
    hierarchy != null &&
    hierarchy.flatItems.length === 1 &&
    context.datasets.length === 0 &&
    context.activeFolderId != null &&
    !context.isLoading &&
    context.globalSearchQuery == null
  ) {
    // Show a placeholder if only the root folder exists and no dataset is available yet
    // (aka a new, empty organization)
    return renderNoDatasetsPlaceHolder();
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplate: "auto / auto minmax(60%, 1fr) auto",
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
          borderRight: "1px solid var(--ant-color-border)",
          marginRight: 16,
        }}
      >
        <FolderTreeSidebar setFolderIdForEditModal={setFolderIdForEditModal} />
      </div>
      <main style={{ gridColumn: "2 / 3", overflow: "auto", paddingRight: 4 }}>
        <DatasetView
          user={props.user}
          onSelectDataset={setSelectedDataset}
          onSelectFolder={setSelectedFolder}
          selectedDatasets={selectedDatasets}
          context={context}
          setFolderIdForEditModal={setFolderIdForEditModal}
        />
      </main>
      <div
        style={{
          gridColumn: "3 / 4",
          overflow: "auto",
          borderLeft: "1px solid var(--ant-color-border)",
          marginLeft: 4,
        }}
      >
        <DetailsSidebar
          selectedDatasets={selectedDatasets}
          setSelectedDataset={setSelectedDataset}
          folderId={folderIdForDetailsSidebar}
          datasetCount={datasetCountForDetailsSidebar}
          setFolderIdForEditModal={setFolderIdForEditModal}
          searchQuery={context.globalSearchQuery}
          displayedFolderEqualsActiveFolder={context.selectedFolder == null}
        />
      </div>
    </div>
  );
}
