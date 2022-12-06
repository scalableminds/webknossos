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
import React, { useEffect } from "react";
import { APIMaybeUnimportedDataset, Folder } from "types/api_flow_types";
import { DatasetLayerTags, DatasetTags, TeamTags } from "../advanced_dataset/dataset_table";
import { useDatasetCollectionContext } from "../dataset/dataset_collection_context";
import { SEARCH_RESULTS_LIMIT, useFolderQuery } from "../dataset/queries";

export function DetailsSidebar({
  selectedDatasets,
  setSelectedDataset,
  datasetCount,
  searchQuery,
  activeFolderId,
  setFolderIdForEditModal,
}: {
  selectedDatasets: APIMaybeUnimportedDataset[];
  setSelectedDataset: (ds: APIMaybeUnimportedDataset | null) => void;
  datasetCount: number;
  searchQuery: string | null;
  activeFolderId: string | null;
  setFolderIdForEditModal: (value: string | null) => void;
}) {
  const context = useDatasetCollectionContext();
  const { data: folder, error } = useFolderQuery(activeFolderId);

  const selectedDataset = selectedDatasets.length > 0 ? selectedDatasets[0] : null;

  useEffect(() => {
    if (selectedDataset == null || !("folderId" in selectedDataset)) {
      return;
    }
    if (
      selectedDataset.folderId !== context.activeFolderId &&
      context.activeFolderId != null &&
      context.globalSearchQuery == null
    ) {
      // Ensure that the selected dataset is in the active folder. If not,
      // clear the sidebar. Don't do this when search results are shown (since
      // these can cover multiple folders).
      // Typically, this is triggered when navigating to another folder.
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
            <div style={{ marginBottom: 4 }}>
              <span className="sidebar-label">Description</span>
              <div>{selectedDataset.description}</div>
            </div>
          )}
          <div style={{ marginBottom: 4 }}>
            <span className="sidebar-label">Access Permissions</span>
            <br />
            <TeamTags dataset={selectedDataset} emptyValue="Administrators & Dataset Managers" />
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
                datasetCount !== SEARCH_RESULTS_LIMIT ? (
                  <>
                    {datasetCount} {pluralize("dataset", datasetCount)} were found. {maybeSelectMsg}
                  </>
                ) : (
                  <>
                    At least {SEARCH_RESULTS_LIMIT} datasets match your search criteria.{" "}
                    {maybeSelectMsg}
                  </>
                )
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
                    This folder contains{" "}
                    <Tooltip title="This number is independent of any filters that might be applied to the current view (e.g., only showing available datasets)">
                      {datasetCount} {pluralize("dataset", datasetCount)}*
                    </Tooltip>
                    . {maybeSelectMsg}
                  </p>
                  <span className="sidebar-label">Access Permissions</span>
                  <br />
                  <FolderTeamTags folder={folder} />
                </div>
              ) : error ? (
                "Could not load folder."
              ) : activeFolderId != null ? (
                <Spin spinning />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FolderTeamTags({ folder }: { folder: Folder }) {
  if (folder.allowedTeamsCumulative.length === 0) {
    return <Tag>Administrators & Dataset Managers</Tag>;
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
