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
import { SidebarSection } from "../sidebar_section";
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
    <div className="dashboard-details-sidebar">
      {selectedDatasets.length === 1 ? (
        <DatasetDetails
          key={selectedDatasets[0].id}
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
  const isForeignOrgaDataset = activeUser?.organization !== selectedDataset.owningOrganization;
  const { data: owningOrganization } = useQuery({
    queryKey: ["organizations", selectedDataset.owningOrganization],
    queryFn: () => getOrganization(selectedDataset.owningOrganization),
    refetchOnWindowFocus: false,
    enabled: isForeignOrgaDataset,
  });
  const owningOrganizationName = owningOrganization?.name;
  const { data: annotationCount } = useQuery({
    queryKey: ["annotationCount", selectedDataset.id],
    queryFn: () => getAnnotationCountForDataset(selectedDataset.id),
    refetchOnWindowFocus: false,
  });

  const renderOrganization = () => {
    if (!isForeignOrgaDataset) return;
    return (
      <OwningOrganizationRow
        organizationId={owningOrganizationName != null ? owningOrganizationName : ""}
      />
    );
  };

  return (
    <Spin spinning={isFetching}>
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
      {selectedDataset.isActive && (
        <SidebarSection label="Dimensions">
          {fullDataset?.isActive && (
            <div className="info-tab-block">
              <VoxelSizeRow dataset={fullDataset} />
              <DatasetExtentRow dataset={fullDataset} />
            </div>
          )}
        </SidebarSection>
      )}

      <SidebarSection label="Access Permissions">
        {fullDataset && (
          <TeamTags dataset={fullDataset} emptyValue="Administrators & Dataset Managers" />
        )}
      </SidebarSection>

      <SidebarSection label="Layers">
        {fullDataset && <DatasetLayerTags dataset={fullDataset} />}
      </SidebarSection>

      {fullDataset?.uploaderFullName != null && (
        <SidebarSection label="Uploaded By">{fullDataset.uploaderFullName}</SidebarSection>
      )}

      <SidebarSection label="Datastore">
        {fullDataset && (
          <Tag color={stringToTagColor(fullDataset.dataStore.name)} variant="outlined">
            {fullDataset.dataStore.name}
          </Tag>
        )}
      </SidebarSection>

      <SidebarSection label="ID">
        {fullDataset && (
          <Tag variant="outlined">
            <FormattedId id={fullDataset.id} />
          </Tag>
        )}
      </SidebarSection>

      {selectedDataset.isActive ? (
        <SidebarSection label="Tags">
          <DatasetTags dataset={selectedDataset} updateDataset={context.updateCachedDataset} />
        </SidebarSection>
      ) : null}

      {fullDataset && (
        /* The key is crucial to enforce rerendering when the dataset changes. This is necessary for the MetadataTable to work correctly. */
        <MetadataTable datasetOrFolder={fullDataset} key={`${fullDataset.id}#dataset`} />
      )}
      {fullDataset?.usedStorageBytes && fullDataset.usedStorageBytes > 10000 ? (
        <SidebarSection label="Used Storage">
          <Tooltip
            title={`${Intl.NumberFormat().format(fullDataset.usedStorageBytes)} bytes`}
            placement="left"
          >
            <div>{formatCountToDataAmountUnit(fullDataset.usedStorageBytes, true)}</div>
          </Tooltip>
        </SidebarSection>
      ) : null}
      <SidebarSection label="Additional Actions">
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
      </SidebarSection>
      {deleteModal}
    </Spin>
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
  let message = datasetCount > 0 ? "Select a dataset to see details." : "";
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
          {message ? <p>{message}</p> : null}
          <SidebarSection label="Access Permissions">
            <FolderTeamTags folder={folder} />
          </SidebarSection>
          {/* The key is crucial to enforce rerendering when the folder changes. This is necessary for the MetadataTable to work correctly. */}
          <MetadataTable datasetOrFolder={folder} key={`${folder.id}#folder`} />
          {folder.isEditable ? (
            <SidebarSection label="Additional Actions">
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
            </SidebarSection>
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
