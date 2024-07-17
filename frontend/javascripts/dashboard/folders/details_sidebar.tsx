import {
  FileOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  EditOutlined,
  LoadingOutlined,
  DeleteOutlined,
  PlusOutlined,
  TagsOutlined,
  FieldNumberOutlined,
  FieldStringOutlined,
} from "@ant-design/icons";
import {
  Typography,
  Input,
  Result,
  Spin,
  Tag,
  Tooltip,
  Dropdown,
  MenuProps,
  InputNumber,
  Select,
  Button,
} from "antd";
import { stringToColor, formatCountToDataAmountUnit } from "libs/format_utils";
import { pluralize } from "libs/utils";
import _ from "lodash";
import {
  DatasetExtentRow,
  OwningOrganizationRow,
  VoxelSizeRow,
} from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import React, { useEffect, useState } from "react";
import {
  APIDataset,
  APIDatasetCompact,
  APIMetadata,
  APIMetadataEntries,
  APIMetadataType,
  Folder,
} from "types/api_flow_types";
import { DatasetLayerTags, TeamTags } from "../advanced_dataset/dataset_table";
import {
  DatasetCollectionContextValue,
  useDatasetCollectionContext,
} from "../dataset/dataset_collection_context";
import { SEARCH_RESULTS_LIMIT, useDatasetQuery, useFolderQuery } from "../dataset/queries";
import { useSelector } from "react-redux";
import { OxalisState } from "oxalis/store";
import { getOrganization } from "admin/admin_rest_api";
import { useQuery } from "@tanstack/react-query";
import { useEffectOnUpdate } from "libs/react_hooks";
import { useWillUnmount } from "beautiful-react-hooks";

function metadataTypeToString(type: APIMetadata["type"]) {
  switch (type) {
    case "string":
      return (
        <span>
          <FieldStringOutlined /> Text
        </span>
      );
    case "number":
      return (
        <span>
          <FieldNumberOutlined /> Number
        </span>
      );
    case "string[]":
      return (
        <span>
          <TagsOutlined /> Multi-Item Text
        </span>
      );
  }
}

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

let isDatasetUpdatePending = false;
const updateCachedDatasetOrFolderDebounced = _.debounce(
  async (
    context: DatasetCollectionContextValue,
    selectedDatasetOrFolder: APIDataset | Folder,
    metadata: APIMetadataEntries,
  ) => {
    isDatasetUpdatePending = false;
    // Explicitly ignoring fetching here to avoid unnecessary rendering of the loading spinner and thus hiding the metadata table.
    if ("folderId" in selectedDatasetOrFolder) {
      await context.updateCachedDataset(selectedDatasetOrFolder, { metadata: metadata });
    } else {
      const folder = selectedDatasetOrFolder;
      await context.queries.updateFolderMutation.mutateAsync({
        ...folder,
        allowedTeams: folder.allowedTeams?.map((t) => t.id) || [],
        metadata,
      });
    }
  },
  3000,
);
const originalFlush = updateCachedDatasetOrFolderDebounced.flush;
updateCachedDatasetOrFolderDebounced.flush = async () => {
  if (!isDatasetUpdatePending) return;
  isDatasetUpdatePending = false;
  originalFlush();
};
function updateCachedDatasetOrFolderDebouncedTracked(
  context: DatasetCollectionContextValue,
  selectedDatasetOrFolder: APIDataset | Folder,
  metadata: APIMetadataEntries,
) {
  isDatasetUpdatePending = true;
  updateCachedDatasetOrFolderDebounced(context, selectedDatasetOrFolder, metadata);
  return updateCachedDatasetOrFolderDebounced;
}

function MetadataTable({
  selectedDatasetOrFolder,
}: { selectedDatasetOrFolder: APIDataset | Folder }) {
  const context = useDatasetCollectionContext();
  const [metadata, setMetadata] = useState<APIMetadataEntries>(
    selectedDatasetOrFolder.metadata || [],
  );
  const [error, setError] = useState<[number, string] | null>(null); // [index, error message]
  const [focusedRow, setFocusedRow] = useState<number | null>(null);

  useEffect(() => {
    if (isDatasetUpdatePending) {
      // Flush pending updates and wait for the next update to update this components metadata.
      // Otherwise, a cyclic update race between the selectedDatasetOrFolder.metadata and the flushed version might occur.
      updateCachedDatasetOrFolderDebounced.flush();
    } else {
      // Update state to newest metadata from selectedDatasetOrFolder.
      setMetadata(selectedDatasetOrFolder.metadata || []);
    }
  }, [selectedDatasetOrFolder.metadata]);

  useEffectOnUpdate(() => {
    updateCachedDatasetOrFolderDebouncedTracked(context, selectedDatasetOrFolder, metadata);
  }, [metadata]);

  // On component unmount flush pending updates to avoid potential data loss.
  useWillUnmount(() => {
    updateCachedDatasetOrFolderDebounced.flush();
  });

  const updatePropName = (index: number, newPropName: string) => {
    setMetadata((prev: APIMetadataEntries) => {
      const entry = prev.find((prop) => prop.index === index);
      const maybeAlreadyExistingEntry = prev.find((prop) => prop.key === newPropName);
      if (maybeAlreadyExistingEntry) {
        if (newPropName !== "") {
          setError([entry?.index || -1, `Property ${newPropName} already exists.`]);
        }
      }
      if (maybeAlreadyExistingEntry || !entry) {
        return prev;
      }
      setError(null);
      const detailsWithoutEditedEntry = prev.filter((prop) => prop.index !== index);
      return [
        ...detailsWithoutEditedEntry,
        {
          ...entry,
          key: newPropName,
        },
      ];
    });
  };

  const updateValue = (index: number, newValue: string | string[]) => {
    setMetadata((prev) => {
      const entry = prev.find((prop) => prop.index === index);
      if (!entry) {
        return prev;
      }
      const updatedEntry = { ...entry, value: newValue };
      const detailsWithoutEditedEntry = prev.filter((prop) => prop.index !== index);
      return [...detailsWithoutEditedEntry, updatedEntry];
    });
  };

  const addType = (type: APIMetadata["type"]) => {
    setMetadata((prev) => {
      const highestIndex = prev.reduce((acc, curr) => Math.max(acc, curr.index), 0);
      const newEntry: APIMetadata = {
        key: "",
        value: type === APIMetadataType.STRING_ARRAY ? [] : "",
        index: highestIndex + 1,
        type,
      };
      return [...prev, newEntry];
    });
  };

  const deleteKey = (index: number) => {
    setMetadata((prev) => {
      return prev.filter((prop) => prop.index !== index);
    });
  };

  const sortedDetails = metadata.sort((a, b) => a.index - b.index);

  const availableStrArrayTagOptions = _.uniq(
    sortedDetails.flatMap((detail) => (detail.type === "string[]" ? detail.value : [])),
  ).map((tag) => ({ value: tag, label: tag }));

  const getTypeSelectDropdownMenu: () => MenuProps = () => ({
    items: Object.values(APIMetadataType).map((type) => {
      return {
        key: type,
        label: metadataTypeToString(type as APIMetadata["type"]),
        onClick: () => addType(type as APIMetadata["type"]),
      };
    }),
  });

  const getValueInput = (record: APIMetadata) => {
    const isFocused = record.index === focusedRow;
    switch (record.type) {
      case "number":
        return (
          <InputNumber
            className={isFocused ? undefined : "transparent-input"}
            onFocus={() => setFocusedRow(record.index)}
            onBlur={() => setFocusedRow(null)}
            value={record.value as number}
            onChange={(newNum) => updateValue(record.index, newNum?.toString() || "")}
            placeholder="Value"
            size="small"
          />
        );
      case "string":
        return (
          <Input
            className={isFocused ? undefined : "transparent-input"}
            onFocus={() => setFocusedRow(record.index)}
            onBlur={() => setFocusedRow(null)}
            value={record.value}
            onChange={(evt) => updateValue(record.index, evt.target.value)}
            placeholder="Value"
            size="small"
          />
        );
      case "string[]":
        return (
          <Select
            onFocus={() => setFocusedRow(record.index)}
            onBlur={() => setFocusedRow(null)}
            className={isFocused ? undefined : "transparent-input"}
            mode="tags"
            placeholder="Values"
            value={record.value as string[]}
            onChange={(values) => updateValue(record.index, values)}
            options={availableStrArrayTagOptions}
            size="small"
            suffixIcon={null}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sidebar-label">Metadata</div>
      <div className="ant-tag antd-app-theme metadata-table-wrapper">
        {/* Not using AntD Table to have more control over the styling. */}
        <table className="ant-tag antd-app-theme metadata-table">
          <thead>
            <tr>
              <th>Property</th>
              <th />
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedDetails.map((record) => {
              const isFocused = record.index === focusedRow;
              return (
                <tr key={record.index}>
                  <td>
                    <Input
                      className={isFocused ? undefined : "transparent-input"}
                      onFocus={() => setFocusedRow(record.index)}
                      onBlur={() => setFocusedRow(null)}
                      style={{ width: 116.5, borderColor: isFocused ? undefined : "transparent" }}
                      value={record.key}
                      onChange={(evt) => updatePropName(record.index, evt.target.value)}
                      placeholder="Property"
                      size="small"
                    />
                    {error != null && error[0] === record.index ? (
                      <>
                        <br />
                        <Typography.Text type="warning">{error[1]}</Typography.Text>
                      </>
                    ) : null}
                  </td>
                  <td>:</td>
                  <td>{getValueInput(record)}</td>
                  <td>
                    <DeleteOutlined
                      onClick={() => deleteKey(record.index)}
                      style={{
                        color: "var(--ant-color-text-tertiary)",
                        visibility: record.key === "" ? "hidden" : "visible",
                        width: 16,
                      }}
                      disabled={record.key === ""}
                    />
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3}>
                <div className="flex-center-child">
                  <Dropdown
                    menu={getTypeSelectDropdownMenu()}
                    placement="bottom"
                    trigger={["hover", "click"]}
                    autoFocus
                  >
                    <Button ghost size="small" style={{ border: "none" }}>
                      <PlusOutlined size={18} style={{ color: "var(--ant-color-text-tertiary)" }} />
                    </Button>
                  </Dropdown>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DatasetDetails({ selectedDataset }: { selectedDataset: APIDatasetCompact }) {
  // exactDatasetId is needed to prevent refetching when some dataset property of selectedDataset was changed.
  const exactDatasetId = {
    owningOrganization: selectedDataset.owningOrganization,
    name: selectedDataset.name,
  };
  const { data: fullDataset, isFetching } = useDatasetQuery(exactDatasetId);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const { data: owningOrganization } = useQuery(
    ["organizations", selectedDataset.owningOrganization],
    () => getOrganization(selectedDataset.owningOrganization),
    {
      refetchOnWindowFocus: false,
    },
  );
  const owningOrganizationDisplayName = owningOrganization?.displayName;

  const renderOrganization = () => {
    if (activeUser?.organization === selectedDataset.owningOrganization) return;
    return (
      <table>
        <tbody>
          <OwningOrganizationRow
            organizationName={
              owningOrganizationDisplayName != null ? owningOrganizationDisplayName : ""
            }
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
        {selectedDataset.displayName || selectedDataset.name}
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
          <div>{fullDataset?.description}</div>
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
        {fullDataset && <MetadataTable selectedDatasetOrFolder={fullDataset} />}
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
          <MetadataTable selectedDatasetOrFolder={folder} />
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
