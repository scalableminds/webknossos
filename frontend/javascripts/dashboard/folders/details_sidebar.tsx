import {
  CopyOutlined,
  EditOutlined,
  FileOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getOrganization } from "admin/rest_api";
import { Result, Spin, Tag, Tooltip } from "antd";
import { formatCountToDataAmountUnit, stringToColor } from "libs/format_utils";
import Markdown from "libs/markdown_adapter";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import _ from "lodash";
import type { WebknossosState } from "oxalis/store";
import {
  DatasetExtentRow,
  OwningOrganizationRow,
  VoxelSizeRow,
} from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import { useEffect } from "react";
import { useSelector } from "react-redux";
import type { APIDatasetCompact, Folder } from "types/api_types";
import { DatasetLayerTags, DatasetTags, TeamTags } from "../advanced_dataset/dataset_table";
import { useDatasetCollectionContext } from "../dataset/dataset_collection_context";
import { SEARCH_RESULTS_LIMIT, useDatasetQuery, useFolderQuery } from "../dataset/queries";
import MetadataTable from "./metadata_table";

export function DetailsSidebar({
  selectedDatasets,
  setSelectedDataset,
  datasetCount,
  searchQuery,
  // The folder ID to display details for. This can be the active folder selected in the tree view
  // or a selected subfolder in the dataset table.
  folderId,
  setFolderIdForEditModal,
  displayedFolderEqualsActiveFolder,
}: {
  selectedDatasets: APIDatasetCompact[];
  setSelectedDataset: (ds: APIDatasetCompact | null) => void;
  folderId: string | null;
  datasetCount: number;
  searchQuery: string | null;
  setFolderIdForEditModal: (value: string | null) => void;
  displayedFolderEqualsActiveFolder: boolean;
}) {
  const context = useDatasetCollectionContext();
  const { data: folder, error } = useFolderQuery(folderId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Needs investigation whether context.globalSearchQuery should be added as a dependency.
  useEffect(() => {
    if (
      selectedDatasets.some((ds) => ds.folderId !== context.activeFolderId) &&
      context.activeFolderId != null &&
      context.globalSearchQuery == null
    ) {
      // Ensure that the selected dataset(s) are in the active folder. If not,
      // clear the selection. Don't do this when search results are shown (since
      // these can cover multiple folders).
      // Typically, this is triggered when navigating to another folder.
      setSelectedDataset(null);
    }
  }, [selectedDatasets, context.activeFolderId]);

  return (
    <div style={{ width: 300, padding: 16 }}>
      {selectedDatasets.length === 1 ? (
        <DatasetDetails selectedDataset={selectedDatasets[0]} />
      ) : selectedDatasets.length > 1 ? (
        <DatasetsDetails selectedDatasets={selectedDatasets} datasetCount={datasetCount} />
      ) : searchQuery ? (
        <SearchDetails datasetCount={datasetCount} />
      ) : (
        <FolderDetails
          folderId={folderId}
          folder={folder}
          datasetCount={datasetCount}
          setFolderIdForEditModal={setFolderIdForEditModal}
          error={error}
          displayedFolderEqualsActiveFolder={displayedFolderEqualsActiveFolder}
        />
      )}
    </div>
  );
}

function getMaybeSelectMessage(datasetCount: number) {
  return datasetCount > 0 ? "Select one to see details." : "";
}

function DatasetDetails({ selectedDataset }: { selectedDataset: APIDatasetCompact }) {
  const context = useDatasetCollectionContext();
  const { data: fullDataset, isFetching } = useDatasetQuery(selectedDataset.id);
  const activeUser = useSelector((state: WebknossosState) => state.activeUser);
  const { data: owningOrganization } = useQuery(
    ["organizations", selectedDataset.owningOrganization],
    () => getOrganization(selectedDataset.owningOrganization),
    {
      refetchOnWindowFocus: false,
    },
  );
  const owningOrganizationName = owningOrganization?.name;

  const renderOrganization = () => {
    if (activeUser?.organization === selectedDataset.owningOrganization) return;
    return (
      <table>
        <tbody>
          <OwningOrganizationRow
            organizationId={owningOrganizationName != null ? owningOrganizationName : ""}
          />
        </tbody>
      </table>
    );
  };

  return (
    <>
      <h4 style={{ wordBreak: "break-all" }}>
        {isFetching ? (
          <LoadingOutlined style={{ marginRight: 4 }} />
        ) : (
          <FileOutlined style={{ marginRight: 4 }} />
        )}{" "}
        {selectedDataset.name}
      </h4>
      {renderOrganization()}
      <Spin spinning={fullDataset == null}>
        {selectedDataset.isActive && (
          <div>
            <div className="sidebar-label">Dimensions</div>
            {fullDataset && (
              <div className="info-tab-block" style={{ marginTop: -3 }}>
                <table
                  style={{
                    fontSize: 14,
                  }}
                >
                  <tbody>
                    <VoxelSizeRow dataset={fullDataset} />
                    <DatasetExtentRow dataset={fullDataset} />
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Description</div>
          <Markdown>{fullDataset?.description}</Markdown>
        </div>

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Access Permissions</div>

          {fullDataset && (
            <TeamTags dataset={fullDataset} emptyValue="Administrators & Dataset Managers" />
          )}
        </div>

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Layers</div>
          {fullDataset && <DatasetLayerTags dataset={fullDataset} />}
        </div>

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Datastore</div>
          {fullDataset && (
            <Tag color={stringToColor(fullDataset.dataStore.name)}>
              {fullDataset.dataStore.name}
            </Tag>
          )}
        </div>

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">ID</div>
          {fullDataset && (
            <Tag>
              {fullDataset.id.substring(0, 10)}...{" "}
              <Tooltip title="Copy Dataset ID">
                <CopyOutlined
                  onClick={() => {
                    navigator.clipboard.writeText(fullDataset.id);
                    Toast.success("Dataset ID copied.");
                  }}
                />
              </Tooltip>
            </Tag>
          )}
        </div>

        {selectedDataset.isActive ? (
          <div style={{ marginBottom: 4 }}>
            <div className="sidebar-label">Tags</div>
            <DatasetTags dataset={selectedDataset} updateDataset={context.updateCachedDataset} />
          </div>
        ) : null}

        {fullDataset && (
          /* The key is crucial to enforce rerendering when the dataset changes. This is necessary for the MetadataTable to work correctly. */
          <MetadataTable datasetOrFolder={fullDataset} key={`${fullDataset.id}#dataset`} />
        )}
      </Spin>

      {fullDataset?.usedStorageBytes && fullDataset.usedStorageBytes > 10000 ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Used Storage</div>
          <Tooltip title="Note that linked and remote layers aren’t measured." placement="left">
            <div>{formatCountToDataAmountUnit(fullDataset.usedStorageBytes, true)}</div>
          </Tooltip>
        </div>
      ) : null}
    </>
  );
}

function DatasetsDetails({
  selectedDatasets,
  datasetCount,
}: {
  selectedDatasets: APIDatasetCompact[];
  datasetCount: number;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      Selected {selectedDatasets.length} of {datasetCount} datasets. Move them to another folder
      with drag and drop.
    </div>
  );
}

function SearchDetails({ datasetCount }: { datasetCount: number }) {
  const maybeSelectMsg = getMaybeSelectMessage(datasetCount);
  return (
    <Result
      icon={<SearchOutlined style={{ fontSize: 50 }} />}
      subTitle={
        datasetCount !== SEARCH_RESULTS_LIMIT ? (
          <>
            {datasetCount} {pluralize("dataset", datasetCount)} were found. {maybeSelectMsg}
          </>
        ) : (
          <>
            At least {SEARCH_RESULTS_LIMIT} datasets match your search criteria. {maybeSelectMsg}
          </>
        )
      }
    />
  );
}

function FolderDetails({
  folderId,
  folder,
  datasetCount,
  setFolderIdForEditModal,
  error,
  displayedFolderEqualsActiveFolder,
}: {
  folderId: string | null;
  folder: Folder | undefined;
  datasetCount: number;
  setFolderIdForEditModal: (id: string | null) => void;
  error: unknown;
  displayedFolderEqualsActiveFolder: boolean;
}) {
  let message = getMaybeSelectMessage(datasetCount);
  if (!displayedFolderEqualsActiveFolder) {
    message =
      datasetCount > 0
        ? `Double-click the folder to list ${pluralize("this", datasetCount, "these")} ${pluralize(
            "dataset",
            datasetCount,
          )}.`
        : "";
  }
  return (
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
                color: "var(--ant-color-text-secondary)",
              }}
            >
              <EditOutlined onClick={() => setFolderIdForEditModal(folder.id)} />
            </span>
            <FolderOpenOutlined style={{ marginRight: 8 }} />
            {folder.name}
          </h4>
          <p>
            This folder contains{" "}
            <Tooltip title="This number is independent of any filters that might be applied to the current view (e.g., only showing available datasets)">
              {datasetCount} {pluralize("dataset", datasetCount)}*
            </Tooltip>
            . {message}
          </p>
          <div className="sidebar-label">Access Permissions</div>
          <div style={{ marginBottom: 4 }}>
            <FolderTeamTags folder={folder} />
          </div>
          {/* The key is crucial to enforce rerendering when the folder changes. This is necessary for the MetadataTable to work correctly. */}
          <MetadataTable datasetOrFolder={folder} key={`${folder.id}#folder`} />
        </div>
      ) : error ? (
        "Could not load folder."
      ) : folderId != null ? (
        <Spin spinning />
      ) : null}
    </>
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
