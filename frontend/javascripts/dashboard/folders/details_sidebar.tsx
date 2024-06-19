import {
  FileOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  EditOutlined,
  LoadingOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { Typography, Input, Result, Spin, Table, Tag, Tooltip } from "antd";
import { stringToColor, formatCountToDataAmountUnit } from "libs/format_utils";
import { pluralize } from "libs/utils";
import _ from "lodash";
import {
  DatasetExtentRow,
  OwningOrganizationRow,
  VoxelSizeRow,
} from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import React, { useEffect, useMemo, useState } from "react";
import { APIDatasetCompact, APIDetails, Folder } from "types/api_flow_types";
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

function MetadataTable({
  selectedDatasetOrFolder,
  setIgnoreFetching,
}: {
  selectedDatasetOrFolder: APIDatasetCompact | Folder;
  setIgnoreFetching: (value: boolean) => void;
}) {
  const context = useDatasetCollectionContext();
  const [details, setDetails] = useState<APIDetails>(selectedDatasetOrFolder.details || {});
  const [errors, setErrors] = useState<Record<string, string>>({}); // propName -> error message.
  const [focusedRow, setFocusedRow] = useState<number | null>(null);

  const updateCachedDatasetOrFolderDebounced = useMemo(
    () =>
      _.debounce(
        async (
          context: DatasetCollectionContextValue,
          selectedDatasetOrFolder: APIDatasetCompact | Folder,
          details: APIDetails,
        ) => {
          console.log("updating", selectedDatasetOrFolder, details);
          // Explicitly ignoring fetching here to avoid unnecessary rendering of the loading spinner and thus hiding the metadata table.
          setIgnoreFetching(true);
          if ("status" in selectedDatasetOrFolder) {
            await context.updateCachedDataset(selectedDatasetOrFolder, { details: details });
          } else {
            const folder = selectedDatasetOrFolder as Folder;
            await context.queries.updateFolderMutation.mutateAsync({
              ...folder,
              allowedTeams: folder.allowedTeams.map((t) => t.id),
              details,
            });
          }
          setIgnoreFetching(false);
        },
        2000,
      ),
    [setIgnoreFetching],
  );

  useEffectOnUpdate(() => {
    updateCachedDatasetOrFolderDebounced(context, selectedDatasetOrFolder, details);
  }, [details]);

  const updatePropName = (previousPropName: string, newPropName: string) => {
    setDetails((prev) => {
      if (prev && newPropName in prev) {
        setErrors((prev) => ({
          ...prev,
          [previousPropName]: `Property ${newPropName} already exists.`,
        }));
        return prev;
      }
      if (prev && previousPropName in prev) {
        const { [previousPropName]: value, ...rest } = prev;
        setErrors((prev) => {
          const { [previousPropName]: _, ...rest } = prev;
          return rest;
        });
        return { ...rest, [newPropName]: value };
      }
      return { ...prev, [newPropName]: "" };
    });
  };
  const updateValue = (propName: string, newValue: string) => {
    setDetails((prev) => {
      if (prev) {
        return { ...prev, [propName]: newValue };
      }
      return { key: newValue };
    });
  };

  const deleteKey = (propName: string) => {
    setDetails((prev) => {
      if (prev) {
        const { [propName]: _, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  };

  const columnData =
    // "": "" is added to always have a row for adding new metadata.
    Object.entries({ ...details, "": "" }).map(([propName, value], index) => ({
      propName,
      value,
      key: index,
    }));

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sidebar-label">Metadata</div>
      <Table
        dataSource={columnData}
        columns={[
          {
            title: "Property",
            dataIndex: "propName",
            render: (propName, record) => {
              const error = errors[propName] ? (
                <Typography.Text type="warning">{errors[propName]}</Typography.Text>
              ) : null;
              return (
                <>
                  <Input
                    onFocus={() => setFocusedRow(record.key)}
                    variant={record.key === focusedRow ? "outlined" : "borderless"}
                    value={propName}
                    onChange={(evt) => updatePropName(propName, evt.target.value)}
                  />
                  <br />
                  {error}
                </>
              );
            },
          },
          {
            title: "Value",
            dataIndex: "value",
            className: "top-aligned-column", // Needed in case of an error in the propName column.
            render: (value, record) => (
              <Input
                onFocus={() => setFocusedRow(record.key)}
                onBlur={() => setFocusedRow(null)}
                variant={record.key === focusedRow ? "outlined" : "borderless"}
                value={value}
                onChange={(evt) => updateValue(record.propName, evt.target.value)}
              />
            ),
          },
          {
            title: "",
            key: "del",
            render: (_, record) => <DeleteOutlined onClick={() => deleteKey(record.propName)} />,
          },
        ]}
        pagination={false}
        size="small"
      />
    </div>
  );
}

function DatasetDetails({ selectedDataset }: { selectedDataset: APIDatasetCompact }) {
  const { data: fullDataset, isFetching } = useDatasetQuery(selectedDataset);
  const [ignoreFetching, setIgnoreFetching] = useState(false);
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
        {isFetching && !ignoreFetching ? (
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
      </Spin>

      {fullDataset?.usedStorageBytes && fullDataset.usedStorageBytes > 10000 ? (
        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Used Storage</div>
          <Tooltip title="Note that linked and remote layers aren’t measured." placement="left">
            <div>{formatCountToDataAmountUnit(fullDataset.usedStorageBytes, true)}</div>
          </Tooltip>
        </div>
      ) : null}

      {selectedDataset.isActive ? (
        <MetadataTable
          selectedDatasetOrFolder={selectedDataset}
          setIgnoreFetching={setIgnoreFetching}
        />
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
          <FolderTeamTags folder={folder} />
          <MetadataTable selectedDatasetOrFolder={folder} setIgnoreFetching={() => {}} />
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
