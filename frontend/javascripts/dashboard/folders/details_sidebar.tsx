import {
  FileOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  EditOutlined,
  LoadingOutlined,
  DeleteOutlined,
  PlusOutlined,
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
} from "antd";
import { stringToColor, formatCountToDataAmountUnit } from "libs/format_utils";
import { parseFloatOrZero, pluralize } from "libs/utils";
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
      return "abc";
    case "number":
      return "123";
    case "string[]":
      return "a,b";
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
  const [error, setError] = useState<[string, string] | null>(null); // [propName, error message]
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  useEffect(() => {
    // Flush pending updates:
    updateCachedDatasetOrFolderDebounced.flush();
    // Update state to newest metadata from selectedDatasetOrFolder.
    setMetadata(selectedDatasetOrFolder.metadata || []);
  }, [selectedDatasetOrFolder.metadata]);

  useEffectOnUpdate(() => {
    updateCachedDatasetOrFolderDebouncedTracked(context, selectedDatasetOrFolder, metadata);
  }, [metadata]);

  // On component unmount flush pending updates to avoid potential data loss.
  useWillUnmount(() => {
    updateCachedDatasetOrFolderDebounced.flush();
  });

  const updatePropName = (previousPropName: string, newPropName: string) => {
    setMetadata((prev: APIMetadataEntries) => {
      const entry = prev.find((prop) => prop.key === previousPropName);
      const maybeAlreadyExistingEntry = prev.find((prop) => prop.key === newPropName);
      if (maybeAlreadyExistingEntry) {
        if (newPropName !== "") {
          setError([previousPropName, `Property ${newPropName} already exists.`]);
        }
        return prev;
      }
      if (entry) {
        setError(null);
        const detailsWithoutEditedEntry = prev.filter((prop) => prop.key !== previousPropName);
        return [
          ...detailsWithoutEditedEntry,
          {
            ...entry,
            key: newPropName,
          },
        ];
      } else {
        const highestIndex = prev.reduce((acc, curr) => Math.max(acc, curr.index), 0);
        const newEntry: APIMetadata = {
          key: newPropName,
          value: "",
          type: APIMetadataType.STRING,
          index: highestIndex + 1,
        };
        return [...prev, newEntry];
      }
    });
  };
  const updateValue = (propName: string, newValue: string | string[]) => {
    setMetadata((prev) => {
      const entry = prev.find((prop) => prop.key === propName);
      if (!entry) {
        return prev;
      }
      const updatedEntry = { ...entry, value: newValue };
      const detailsWithoutEditedEntry = prev.filter((prop) => prop.key !== propName);
      return [...detailsWithoutEditedEntry, updatedEntry];
    });
  };

  const updateType = (index: number, newType: APIMetadata["type"]) => {
    setMetadata((prev) => {
      const entry = prev.find((prop) => prop.index === index);
      if (!entry) {
        return prev;
      }
      let updatedEntry = { ...entry, type: newType };
      if (newType === "string[]" && entry.type !== "string[]") {
        updatedEntry = { ...updatedEntry, value: [entry.value.toString()] };
      } else if (newType === "number" && entry.type !== "number") {
        updatedEntry = {
          ...updatedEntry,
          value: parseFloatOrZero(
            Array.isArray(entry.value) ? entry.value.join(" ") : entry.value.toString(),
          ),
        };
      } else if (newType === "string" && entry.type !== "string") {
        updatedEntry = {
          ...updatedEntry,
          value: Array.isArray(entry.value) ? entry.value.join(" ") : entry.value.toString(),
        };
      }

      const detailsWithoutEditedEntry = prev.filter((prop) => prop.index !== index);
      return [...detailsWithoutEditedEntry, updatedEntry];
    });
  };

  const deleteKey = (propName: string) => {
    setMetadata((prev) => {
      return prev.filter((prop) => prop.key !== propName);
    });
  };

  const sortedDetails = metadata.sort((a, b) => a.index - b.index);

  const availableStrArrayTagOptions = _.uniq(
    sortedDetails.flatMap((detail) => (detail.type === "string[]" ? detail.value : [])),
  ).map((tag) => ({ value: tag, label: tag }));

  const getTypeSelectDropdownMenu: (propertyIndex: number) => MenuProps = (
    propertyIndex: number,
  ) => ({
    items: Object.values(APIMetadataType).map((type) => {
      return {
        key: type,
        label: metadataTypeToString(type as APIMetadata["type"]),
        onClick: () => updateType(propertyIndex, type as APIMetadata["type"]),
      };
    }),
  });

  const getValueInput = (record: APIMetadata) => {
    const isFocused = record.index === focusedRow;
    switch (record.type) {
      case "number":
        return (
          <InputNumber
            onFocus={() => setFocusedRow(record.index)}
            onBlur={() => setFocusedRow(null)}
            style={{ width: 100.5, borderColor: isFocused ? undefined : "transparent" }}
            value={record.value as number}
            onChange={(newNum) => updateValue(record.key, newNum?.toString() || "")}
            placeholder="Value"
            size="small"
          />
        );
      case "string":
        return (
          <Input
            onFocus={() => setFocusedRow(record.index)}
            onBlur={() => setFocusedRow(null)}
            style={{ width: 100.5, borderColor: isFocused ? undefined : "transparent" }}
            value={record.value}
            onChange={(evt) => updateValue(record.key, evt.target.value)}
            placeholder="Value"
            size="small"
          />
        );
      case "string[]":
        return (
          <Select
            onFocus={() => setFocusedRow(record.index)}
            onBlur={() => setFocusedRow(null)}
            style={{ width: 100.5, borderColor: isFocused ? undefined : "transparent" }}
            mode="tags"
            placeholder="Values"
            value={record.value as string[]}
            onChange={(values) => updateValue(record.key, values)}
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
      <div>
        {/* Not using AntD Table to have more control over the styling. */}
        <table className="ant-tag antd-app-theme metadata-table">
          <thead>
            <tr>
              <th>Type</th>
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
                    <Dropdown menu={getTypeSelectDropdownMenu(record.index)}>
                      <Tag
                        style={{
                          margin: 0,
                          width: 32,
                          color: "var(--ant-color-text-tertiary)",
                          borderColor: "var(--ant-color-border-secondary)",
                        }}
                        className="flex-center-child"
                      >
                        {metadataTypeToString(record.type)}
                      </Tag>
                    </Dropdown>
                  </td>
                  <td>
                    <Input
                      onFocus={() => setFocusedRow(record.index)}
                      onBlur={() => setFocusedRow(null)}
                      style={{ width: 100.5, borderColor: isFocused ? undefined : "transparent" }}
                      value={record.key}
                      onChange={(evt) => updatePropName(record.key, evt.target.value)}
                      placeholder="Property"
                      size="small"
                    />
                    {error != null && error[0] === record.key ? (
                      <>
                        <br />
                        <Typography.Text type="warning">{error[1]}</Typography.Text>
                      </>
                    ) : null}
                  </td>
                  <td>
                    <span style={{ width: 5 }}>:</span>
                  </td>
                  <td>{getValueInput(record)}</td>
                  <td>
                    <DeleteOutlined
                      onClick={() => deleteKey(record.key)}
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
          </tbody>
        </table>
        <div className="flex-center-child" style={{ marginLeft: 12 }}>
          <div
            style={{
              borderStyle: "var(--ant-line-type)",
              borderWidth: "0 var(--ant-line-width) var(--ant-line-width) var(--ant-line-width)",
              borderColor: "var(--ant-color-border)",
              width: 18,
              height: 18,
              marginLeft: 22,
            }}
            className="flex-center-child"
          >
            <PlusOutlined
              size={18}
              style={{ color: "var(--ant-color-text-tertiary)" }}
              onClick={() => updatePropName("", "")}
            />
          </div>
        </div>
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
