import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getOrganization } from "admin/api/organization";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { getAnnotationCountForDataset } from "admin/rest_api";
import { Button, Result, Space, Spin, Tag, Tooltip, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import FormattedId from "components/formatted_id";
import { PricingEnforcedSpan } from "components/pricing_enforcers";
import { stringToTagColor } from "libs/colors";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import Markdown from "libs/markdown_adapter";
import { useWkSelector } from "libs/react_hooks";
import { pluralize } from "libs/utils";
import keyBy from "lodash-es/keyBy";
import { useEffect } from "react";
import { Link } from "react-router";
import type { APIDatasetCompact, Folder } from "types/api_types";
import Constants from "viewer/constants";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { DatasetExtentRow } from "viewer/view/right_border_tabs/info_tab/dataset_extent_row";
import { OwningOrganizationRow } from "viewer/view/right_border_tabs/info_tab/owning_organization_row";
import { VoxelSizeRow } from "viewer/view/right_border_tabs/info_tab/voxel_size_row";
import { useReloadDataset } from "../advanced_dataset/dataset_action_view";
import { DatasetLayerTags, DatasetTags, TeamTags } from "../advanced_dataset/dataset_table";
import {
  canDeleteDataset,
  useDeleteDatasetsModal,
} from "../advanced_dataset/delete_datasets_modal";
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
  displayedFolderEqualsActiveFolder,
}: {
  selectedDatasets: APIDatasetCompact[];
  setSelectedDataset: (ds: APIDatasetCompact | null) => void;
  folderId: string | null;
  datasetCount: number;
  searchQuery: string | null;
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
    <div
      style={{ width: 300, padding: 16, position: "sticky", top: Constants.DEFAULT_NAVBAR_HEIGHT }}
    >
      {selectedDatasets.length === 1 ? (
        <DatasetDetails
          selectedDataset={selectedDatasets[0]}
          onDeleted={() => setSelectedDataset(null)}
        />
      ) : selectedDatasets.length > 1 ? (
        <DatasetsDetails selectedDatasets={selectedDatasets} datasetCount={datasetCount} />
      ) : searchQuery ? (
        <SearchDetails datasetCount={datasetCount} />
      ) : (
        <FolderDetails
          folderId={folderId}
          folder={folder}
          datasetCount={datasetCount}
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

function DatasetDetails({
  selectedDataset,
  onDeleted,
}: {
  selectedDataset: APIDatasetCompact;
  onDeleted: () => void;
}) {
  const context = useDatasetCollectionContext();
  const { isReloading, reloadDataset } = useReloadDataset();
  const { openDeleteModal, deleteModal } = useDeleteDatasetsModal({ onDeleted });
  const { data: fullDataset, isFetching } = useDatasetQuery(selectedDataset.id);
  const activeUser = useWkSelector((state) => state.activeUser);
  const { data: owningOrganization } = useQuery({
    queryKey: ["organizations", selectedDataset.owningOrganization],
    queryFn: () => getOrganization(selectedDataset.owningOrganization),
    refetchOnWindowFocus: false,
  });
  const owningOrganizationName = owningOrganization?.name;
  const { data: annotationCount } = useQuery({
    queryKey: ["annotationCount", selectedDataset.id],
    queryFn: () => getAnnotationCountForDataset(selectedDataset.id),
    refetchOnWindowFocus: false,
  });

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
      <Typography.Title level={4} style={{ wordBreak: "break-all" }}>
        {selectedDataset.name}
        {selectedDataset.isEditable ? (
          <FastTooltip title="Edit dataset settings">
            <Link
              to={`/datasets/${getReadableURLPart(selectedDataset)}/edit`}
              style={{ paddingLeft: 6, fontSize: 16 }}
            >
              <Typography.Text type="secondary">
                <SettingOutlined />
              </Typography.Text>
            </Link>
          </FastTooltip>
        ) : null}
      </Typography.Title>
      {fullDataset?.description ? <Markdown>{fullDataset.description}</Markdown> : null}
      {renderOrganization()}
      <Spin spinning={isFetching}>
        {selectedDataset.isActive && (
          <div>
            <div className="sidebar-label">Dimensions</div>
            {fullDataset?.isActive && (
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
          <div className="sidebar-label">Access Permissions</div>

          {fullDataset && (
            <TeamTags dataset={fullDataset} emptyValue="Administrators & Dataset Managers" />
          )}
        </div>

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Layers</div>
          {fullDataset && <DatasetLayerTags dataset={fullDataset} />}
        </div>

        {fullDataset?.uploaderFullName != null && (
          <div style={{ marginBottom: 4 }}>
            <div className="sidebar-label">Uploaded By</div>
            <div>{fullDataset.uploaderFullName}</div>
          </div>
        )}

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">Datastore</div>
          {fullDataset && (
            <Tag color={stringToTagColor(fullDataset.dataStore.name)} variant="outlined">
              {fullDataset.dataStore.name}
            </Tag>
          )}
        </div>

        <div style={{ marginBottom: 4 }}>
          <div className="sidebar-label">ID</div>
          {fullDataset && (
            <Tag variant="outlined">
              <FormattedId id={fullDataset.id} />
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
          <Tooltip
            title={`${Intl.NumberFormat().format(fullDataset.usedStorageBytes)} bytes`}
            placement="left"
          >
            <div>{formatCountToDataAmountUnit(fullDataset.usedStorageBytes, true)}</div>
          </Tooltip>
        </div>
      ) : null}
      <div style={{ marginBottom: 4 }}>
        <div className="sidebar-label">Actions</div>
        <div className="dataset-table-actions">
          {annotationCount != null && annotationCount > 0 ? (
            <Link to={`/dashboard/annotations?dataset=${encodeURIComponent(selectedDataset.name)}`}>
              <UnorderedListOutlined className="icon-margin-right" />
              Show {annotationCount} {pluralize("Annotation", annotationCount)}
            </Link>
          ) : null}
          <a onClick={() => !isReloading && reloadDataset(selectedDataset.id)}>
            {isReloading ? (
              <LoadingOutlined className="icon-margin-right" />
            ) : (
              <ReloadOutlined className="icon-margin-right" />
            )}
            Reload
          </a>
          {canDeleteDataset(selectedDataset) ? (
            <a onClick={() => openDeleteModal([selectedDataset])}>
              <DeleteOutlined className="icon-margin-right" />
              Delete
            </a>
          ) : null}
        </div>
      </div>
      {deleteModal}
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
  const { openDeleteModal, deleteModal } = useDeleteDatasetsModal();
  const deletableCount = selectedDatasets.filter(canDeleteDataset).length;

  return (
    <div style={{ textAlign: "center" }}>
      <Space orientation="vertical" size="large">
        <div>
          Selected {selectedDatasets.length} of {datasetCount} datasets. Move them to another folder
          with drag and drop.
        </div>
        {deletableCount > 0 && (
          <Button onClick={() => openDeleteModal(selectedDatasets)} icon={<DeleteOutlined />}>
            Delete {deletableCount} {pluralize("dataset", deletableCount)}
          </Button>
        )}
      </Space>
      {deleteModal}
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
  error,
  displayedFolderEqualsActiveFolder,
}: {
  folderId: string | null;
  folder: Folder | undefined;
  datasetCount: number;
  error: unknown;
  displayedFolderEqualsActiveFolder: boolean;
}) {
  const context = useDatasetCollectionContext();
  const hierarchy = context.queries.folderHierarchyQuery.data;
  // The organization's root folder can't be deleted. Unknown folders count as root to be safe.
  const isRootFolder = folderId == null || hierarchy?.itemById[folderId]?.parent == null;
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
          <Typography.Title level={4} style={{ wordBreak: "break-all" }}>
            <span
              style={{
                float: "right",
                fontSize: 16,
                marginTop: 2,
                marginLeft: 2,
                color: "var(--ant-color-text-secondary)",
              }}
            >
              <EditOutlined
                onClick={() => context.setFolderModalState({ mode: "edit", folderId: folder.id })}
              />
            </span>
            <FolderOpenOutlined style={{ marginRight: 8 }} />
            {folder.name}
          </Typography.Title>
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
          {folder.isEditable ? (
            <div style={{ marginBottom: 4 }}>
              <div className="sidebar-label">Actions</div>
              <div className="dataset-table-actions">
                <a
                  onClick={() => context.setFolderModalState({ mode: "edit", folderId: folder.id })}
                >
                  <PricingEnforcedSpan requiredPricingPlan={PricingPlanEnum.Team}>
                    <EditOutlined className="icon-margin-right" />
                    Edit
                  </PricingEnforcedSpan>
                </a>
                {isRootFolder ? null : (
                  <a onClick={() => context.queries.deleteFolderMutation.mutateAsync(folder.id)}>
                    <DeleteOutlined className="icon-margin-right" />
                    Delete
                  </a>
                )}
              </div>
            </div>
          ) : null}
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
    return <Tag variant="outlined">Administrators & Dataset Managers</Tag>;
  }
  const allowedTeamsById = keyBy(folder.allowedTeams, "id");

  return (
    <Space>
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
              color={stringToTagColor(team.name)}
              variant="outlined"
            >
              {team.name}
              {isCumulative ? "*" : ""}
            </Tag>
          </Tooltip>
        );
      })}
    </Space>
  );
}
