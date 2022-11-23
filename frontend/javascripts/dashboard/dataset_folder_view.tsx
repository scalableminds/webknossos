import {
  FileOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Result, Spin, Tag, Tooltip } from "antd";
import { stringToColor } from "libs/format_utils";
import { pluralize } from "libs/utils";
import _ from "lodash";
import { DatasetExtentRow } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import React, { useEffect, useState } from "react";
import { APIMaybeUnimportedDataset, APIUser, Folder } from "types/api_flow_types";
import { DatasetLayerTags, DatasetTags, TeamTags } from "./advanced_dataset/dataset_table";
import DatasetCollectionContextProvider, {
  useDatasetCollectionContext,
} from "./dataset/dataset_collection_context";
import { useFolderQuery } from "./dataset/queries";

import DatasetView from "./dataset_view";
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
  const [selectedDataset, setSelectedDataset] = useState<APIMaybeUnimportedDataset | null>(null);
  const context = useDatasetCollectionContext();
  const [folderIdForEditModal, setFolderIdForEditModal] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedDataset || !context.datasets) {
      return;
    }
    // If the cache changed (e.g., because a dataset was updated), we need to update
    // the selectedDataset instance, too, to avoid that it refers to stale data.
    setSelectedDataset(context.datasets.find((ds) => ds.name === selectedDataset.name) ?? null);
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
          selectedDataset={selectedDataset}
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
          selectedDataset={selectedDataset}
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

function DetailsSidebar({
  selectedDataset,
  setSelectedDataset,
  datasetCount,
  searchQuery,
  activeFolderId,
  setFolderIdForEditModal,
}: {
  selectedDataset: APIMaybeUnimportedDataset | null;
  setSelectedDataset: (ds: APIMaybeUnimportedDataset | null) => void;
  datasetCount: number;
  searchQuery: string | null;
  activeFolderId: string | null;
  setFolderIdForEditModal: (value: string | null) => void;
}) {
  const context = useDatasetCollectionContext();
  const { data: folder, error } = useFolderQuery(activeFolderId);

  useEffect(() => {
    if (selectedDataset == null || !("folderId" in selectedDataset)) {
      return;
    }
    if (selectedDataset.folderId !== context.activeFolderId) {
      // Ensure that the selected dataset is in the active folder. If not,
      // clear the sidebar
      setSelectedDataset(null);
    }
  }, [selectedDataset, context.activeFolderId]);

  const maybeSelectMsg = datasetCount > 0 ? "Select one to see details." : "";

  return (
    <div style={{ width: 300, padding: 16 }}>
      {selectedDataset != null ? (
        <>
          <h4 style={{ wordBreak: "break-all" }}>
            <FileOutlined style={{ marginRight: 4 }} />{" "}
            {selectedDataset.displayName || selectedDataset.name}
          </h4>
          {selectedDataset.isActive && (
            <div>
              <span className="sidebar-label">Voxel Size & Extent</span>
              <div className="info-tab-block" style={{ marginTop: -6 }}>
                <table
                  style={{
                    fontSize: 14,
                  }}
                >
                  <tbody>
                    <DatasetExtentRow dataset={selectedDataset} />
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {selectedDataset.description && (
            <div style={{ marginBottom: 12 }}>Description: {selectedDataset.description}</div>
          )}
          <div style={{ marginBottom: 4 }}>
            <span className="sidebar-label">Access Permissions</span>
            <br />
            <TeamTags dataset={selectedDataset} emptyValue="default" />
          </div>
          <div style={{ marginBottom: 4 }}>
            <span className="sidebar-label">Layers</span>
            <br /> <DatasetLayerTags dataset={selectedDataset} />
          </div>
          {selectedDataset.isActive ? (
            <div style={{ marginBottom: 4 }}>
              <span className="sidebar-label">Tags</span>
              <DatasetTags dataset={selectedDataset} updateDataset={context.updateCachedDataset} />
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ textAlign: "center" }}>
          {searchQuery ? (
            <Result
              icon={<SearchOutlined style={{ fontSize: 50 }} />}
              subTitle={
                <>
                  {datasetCount} {pluralize("dataset", datasetCount)} were found. {maybeSelectMsg}
                </>
              }
            />
          ) : (
            <>
              {folder ? (
                <div style={{ textAlign: "left" }}>
                  <h4 style={{ wordBreak: "break-all" }}>
                    <span
                      style={{
                        float: "right",
                        fontSize: 16,
                        marginTop: 2,
                        marginLeft: 2,
                        color: "var(--ant-text-secondary)",
                      }}
                    >
                      <SettingOutlined onClick={() => setFolderIdForEditModal(folder.id)} />
                    </span>
                    <FolderOpenOutlined style={{ marginRight: 8 }} />
                    {folder.name}
                  </h4>
                  <p>
                    This folder contains {datasetCount} {pluralize("dataset", datasetCount)}.{" "}
                    {maybeSelectMsg}
                  </p>
                  <span className="sidebar-label">Access Permissions</span>
                  <br />
                  <FolderTeamTags folder={folder} />
                </div>
              ) : error ? (
                "Could not load folder."
              ) : (
                <Spin spinning />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FolderTeamTags({ folder }: { folder: Folder }) {
  if (folder.allowedTeamsCumulative.length === 0) {
    return <Tag>default</Tag>;
  }
  const allowedTeamsById = _.keyBy(folder.allowedTeams, "id");

  return (
    <>
      {folder.allowedTeamsCumulative.map((team) => {
        const isCumulative = !allowedTeamsById[team.id];
        return (
          <Tooltip
            title={
              isCumulative
                ? "This team may access this folder, because of the permissions of the parent folders."
                : null
            }
            key={team.name}
          >
            <Tag
              style={{
                maxWidth: 200,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
              color={stringToColor(team.name)}
            >
              {team.name}
              {isCumulative ? "*" : ""}
            </Tag>
          </Tooltip>
        );
      })}
    </>
  );
}
