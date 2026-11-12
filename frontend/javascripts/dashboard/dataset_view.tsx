import {
  EllipsisOutlined,
  HourglassOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { TOOLTIP_MESSAGES_AND_ICONS } from "admin/job/job_list_view";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { getJobs } from "admin/rest_api";
import {
  Alert,
  Button,
  Col,
  Dropdown,
  Flex,
  Input,
  Row,
  Select,
  Space,
  Tooltip,
  Typography,
} from "antd";
import type { ItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import FormattedDate from "components/formatted_date";
import { PricingEnforcedButton } from "components/pricing_enforcers";
import DatasetTable from "dashboard/advanced_dataset/dataset_table";
import dayjs from "dayjs";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import { isPrimaryPointerFine, isUserAdminOrDatasetManager, isUserTeamManager } from "libs/utils";
import type React from "react";
import { Fragment, useContext, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  type APIDatasetCompact,
  type APIJob,
  APIJobCommand,
  type APIUser,
  type FolderItem,
} from "types/api_types";
import { Unicode } from "viewer/constants";
import { CategorizationSearch } from "viewer/view/components/categorization_label";
import { RenderToPortal } from "viewer/view/layouting/portal_utils";
import { FolderBreadcrumb } from "./advanced_dataset/folder_breadcrumb";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";
import {
  type DatasetCollectionContextValue,
  LOCAL_STORAGE_FILTER_TAGS_KEY,
} from "./dataset/dataset_collection_context";
import {
  MINIMUM_SEARCH_QUERY_LENGTH,
  SEARCH_RESULTS_LIMIT,
  useFolderQuery,
} from "./dataset/queries";
import { useIsCompactDashboard } from "./responsive_sidebar";

type Props = {
  user: APIUser;
  context: DatasetCollectionContextValue;
  onSelectDataset: (
    dataset: APIDatasetCompact | null,
    multiSelect?: boolean,
    isDragStart?: boolean,
  ) => void;
  onSelectFolder: (folder: FolderItem | null) => void;
  selectedDatasets: APIDatasetCompact[];
  // Custom content shown as the table's empty state instead of the regular hint text.
  // Used for cards for a brand-new organizations.
  emptyStateContent?: React.ReactNode;
  // The button that opens the folder drawer on compact screens. It is part of the toolbar, so
  // that it wraps with the same spacing as the other toolbar items.
  folderPicker?: React.ReactNode;
};
const CONVERSION_JOBS_REFRESH_INTERVAL = 60 * 1000;
const MAX_JOBS_TO_DISPLAY = 5;
const RECENT_DATASET_DAY_THRESHOLD = 3;

const refreshMenuItems: ItemType[] = [
  {
    key: "1",
    label: "Scan disk for new datasets",
  },
];

function DatasetView({
  user,
  context,
  onSelectDataset,
  selectedDatasets,
  onSelectFolder,
  emptyStateContent,
  folderPicker,
}: Props) {
  const searchQuery = context.globalSearchQuery;
  const isCompact = useIsCompactDashboard("xl");
  const setSearchQuery = context.setGlobalSearchQuery;
  const { searchTags, setSearchTags, datasetFilteringMode, setDatasetFilteringMode } = context;
  // Errors are swallowed so that a failing poll doesn't show a toast every few seconds.
  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs", APIJobCommand.CONVERT_TO_WKW, true],
    queryFn: () => getJobs(APIJobCommand.CONVERT_TO_WKW, true, { showErrorToast: false }),
    enabled: features().jobsEnabled,
    refetchInterval: CONVERSION_JOBS_REFRESH_INTERVAL,
    retry: false,
    meta: { persist: false },
  });
  const { data: folder } = useFolderQuery(context.activeFolderId);

  const activeTab = useContext(ActiveTabContext);
  const renderingTab = useContext(RenderingTabContext);

  function addTagToSearch(tag: string) {
    if (!searchTags.includes(tag)) {
      setSearchTags([...searchTags, tag]);
    }
  }

  function clearSearchAndFilters() {
    setSearchQuery(null);
    setSearchTags([]);
    setDatasetFilteringMode("onlyShowReported");
  }

  function handleSearch(event: React.SyntheticEvent<HTMLInputElement>) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const value = event.target.value;
    setSearchQuery(value);
  }

  function renderTable(
    datasets: APIDatasetCompact[],
    subfolders: FolderItem[],
    isLoading: boolean,
  ) {
    return (
      <DatasetTable
        context={context}
        datasets={datasets}
        subfolders={subfolders}
        onSelectDataset={onSelectDataset}
        selectedDatasets={selectedDatasets}
        searchQuery={searchQuery || ""}
        searchTags={searchTags}
        setSearchTags={setSearchTags}
        onSelectFolder={onSelectFolder}
        isUserAdminOrDatasetManager={isUserAdminOrDatasetManager(user)}
        datasetFilteringMode={datasetFilteringMode}
        setDatasetFilteringMode={setDatasetFilteringMode}
        updateDataset={context.updateCachedDataset}
        addTagToSearch={addTagToSearch}
        onClearSearchAndFilters={clearSearchAndFilters}
        isLoading={isLoading}
        emptyStateContent={emptyStateContent}
        isCompact={isCompact}
      />
    );
  }

  const searchBox = (
    <Input
      prefix={<SearchOutlined />}
      allowClear
      // Autofocusing on touch devices would pop up the on-screen keyboard.
      autoFocus={isPrimaryPointerFine()}
      style={{
        width: 200,
      }}
      onPressEnter={handleSearch}
      onChange={handleSearch}
      value={searchQuery || ""}
    />
  );

  const isUserAnAdminOrDatasetManager = isUserAdminOrDatasetManager(user);
  const isUserAdminOrDatasetManagerOrTeamManager =
    isUserAnAdminOrDatasetManager || isUserTeamManager(user);

  const adminHeader = isUserAdminOrDatasetManagerOrTeamManager ? (
    <Space wrap>
      {folderPicker}
      <DatasetRefreshButton context={context} />
      <DatasetAddButton context={context} />
      {context.activeFolderId != null && (
        <PricingEnforcedButton
          disabled={folder != null && !folder.isEditable}
          icon={<PlusOutlined />}
          onClick={() =>
            context.activeFolderId != null &&
            context.setFolderModalState({
              mode: "create",
              parentFolderId: context.activeFolderId,
            })
          }
          requiredPricingPlan={PricingPlanEnum.Team}
        >
          Add Folder
        </PricingEnforcedButton>
      )}
      {searchBox}
    </Space>
  ) : (
    <Space wrap>
      {folderPicker}
      {searchBox}
    </Space>
  );

  const datasets = context.datasets;
  // Don't show subfolders when the search is active
  const subfolders = searchQuery == null ? context.getActiveSubfolders() : [];

  const isEmpty =
    datasets.length === 0 &&
    datasetFilteringMode !== "onlyShowUnreported" &&
    subfolders.length === 0;
  const isLoading = datasets.length === 0 && context.isLoading;

  return (
    <div>
      <RenderToPortal portalId="dashboard-TabBarExtraContent">
        {activeTab === renderingTab ? adminHeader : null}
      </RenderToPortal>
      {searchQuery && (
        <GlobalSearchHeader searchQuery={searchQuery} isEmpty={isEmpty} context={context} />
      )}

      <CategorizationSearch
        itemName="datasets"
        searchTags={searchTags}
        setTags={setSearchTags}
        localStorageSavingKey={LOCAL_STORAGE_FILTER_TAGS_KEY}
        // The context provider already restored the tags when it was created.
        skipRestoreFromStorage
      />
      {!searchQuery && <FolderBreadcrumb context={context} />}
      <NewJobsAlert jobs={jobs} />
      {renderTable(datasets, subfolders, isLoading)}
    </div>
  );
}

export function DatasetRefreshButton({ context }: { context: DatasetCollectionContextValue }) {
  const showLoadingIndicator = context.isLoading || context.isChecking;
  const organizationId = useWkSelector((state) => state.activeOrganization?.id);

  return (
    <Space.Compact>
      <FastTooltip
        title={showLoadingIndicator ? "Refreshing the dataset list." : "Refresh the dataset list."}
      >
        <Button
          onClick={() => context.fetchDatasets()}
          disabled={context.isChecking}
          icon={showLoadingIndicator ? <LoadingOutlined /> : <ReloadOutlined />}
        >
          Refresh
        </Button>
      </FastTooltip>
      <Dropdown
        menu={{ onClick: () => context.checkDatasets(organizationId), items: refreshMenuItems }}
      >
        <Button disabled={context.isChecking} icon={<EllipsisOutlined />} />
      </Dropdown>
    </Space.Compact>
  );
}

export function DatasetAddButton({ context }: { context: DatasetCollectionContextValue }) {
  const { data: folder } = useFolderQuery(context.activeFolderId);

  return (
    <Link
      to={
        context.activeFolderId != null && (folder == null || folder.isEditable)
          ? `/datasets/upload?to=${context.activeFolderId}`
          : "/datasets/upload"
      }
    >
      <Button type="primary" icon={<PlusOutlined />}>
        Add Dataset
      </Button>
    </Link>
  );
}

const SEARCH_OPTIONS = [
  { label: "Search everywhere", value: "everywhere" },
  { label: "Search current folder", value: "folder" },
  { label: "Search current folder and its subfolders", value: "folder-with-subfolders" },
];

function GlobalSearchHeader({
  searchQuery,
  isEmpty,
  context,
}: {
  searchQuery: string;
  isEmpty: boolean;
  context: DatasetCollectionContextValue;
}) {
  const { data: folderHierarchy } = context.queries.folderHierarchyQuery;
  const [treeData, setTreeData] = useState<FolderItem[]>([]);
  const { activeFolderId, setActiveFolderId } = context;

  useEffect(() => {
    const newTreeData = folderHierarchy?.tree || [];
    setTreeData(newTreeData);
  }, [folderHierarchy]);

  if (searchQuery.length < MINIMUM_SEARCH_QUERY_LENGTH) {
    // No results are shown because the search query is too short (at least
    // when the back-end search is used. The frontend search doesn't have
    // this restriction which is why isEmpty is checked, too).
    return isEmpty ? (
      <Typography.Title level={3}>
        <Space>
          <SearchOutlined />
          <span>Enter at least {MINIMUM_SEARCH_QUERY_LENGTH} characters to search</span>
        </Space>
      </Typography.Title>
    ) : null;
  }

  return (
    <Flex justify="space-between">
      <Space>
        <Typography.Title level={3}>
          <Space>
            <SearchOutlined />
            <span>Search Results for “{searchQuery}”</span>
          </Space>
        </Typography.Title>
        {context.areSearchResultsLimited ? (
          <Typography.Text type="secondary">
            (only showing the first {SEARCH_RESULTS_LIMIT} results.{" "}
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              loading={context.queries.datasetSearchQuery.isFetching}
              onClick={context.loadAllSearchResults}
            >
              Load all
            </Button>
            )
          </Typography.Text>
        ) : null}
      </Space>
      <div>
        <Select
          options={SEARCH_OPTIONS}
          popupMatchSelectWidth={false}
          onChange={(value) => {
            if (value === "everywhere") {
              setActiveFolderId(null);
            } else {
              if (
                activeFolderId == null &&
                (context.mostRecentlyUsedActiveFolderId != null || treeData.length > 0)
              ) {
                setActiveFolderId(context.mostRecentlyUsedActiveFolderId || treeData[0]?.key);
              }
              context.setSearchRecursively(value === "folder-with-subfolders");
            }
          }}
          value={
            activeFolderId == null
              ? "everywhere"
              : context.searchRecursively
                ? "folder-with-subfolders"
                : "folder"
          }
        />
      </div>
    </Flex>
  );
}

function NewJobsAlert({ jobs }: { jobs: APIJob[] }) {
  const now = dayjs();
  const newJobs = jobs
    .filter(
      (job) =>
        job.command === "convert_to_wkw" &&
        dayjs.duration(now.diff(job.created)).asDays() <= RECENT_DATASET_DAY_THRESHOLD,
    )
    .sort((a, b) => b.created - a.created);

  if (newJobs.length === 0) {
    return null;
  }

  const newJobsHeader = (
    <Fragment>
      Recent Dataset Conversions{" "}
      <Tooltip
        title="The conversion of the displayed datasets were started in the last 3 days."
        placement="right"
      >
        <InfoCircleOutlined />
      </Tooltip>
    </Fragment>
  );
  const newJobsList = (
    <div
      style={{
        paddingTop: 8,
      }}
    >
      {newJobs.slice(0, MAX_JOBS_TO_DISPLAY).map((job) => {
        const { tooltip, icon } = TOOLTIP_MESSAGES_AND_ICONS[job.state];
        return (
          <Row key={job.id} gutter={16}>
            <Col>
              <Tooltip title={tooltip}>{icon}</Tooltip>{" "}
              {job.state === "SUCCESS" && job.resultLink ? (
                <Link to={job.resultLink}>{job.args.datasetName}</Link>
              ) : (
                job.args.datasetName || "UNKNOWN"
              )}
              {Unicode.NonBreakingSpace}(started at{Unicode.NonBreakingSpace}
              <FormattedDate timestamp={job.created} />
              <span>)</span>
            </Col>
          </Row>
        );
      })}
      <Row
        key="overview"
        style={{
          marginTop: 12,
        }}
      >
        <Col>
          <Link to="/jobs" title="Jobs Overview">
            See complete list
          </Link>
        </Col>
      </Row>
    </div>
  );
  return (
    <Alert
      title={newJobsHeader}
      description={newJobsList}
      type="info"
      style={{
        marginTop: 12,
        marginBottom: 12,
      }}
      showIcon
      icon={<HourglassOutlined />}
    />
  );
}

export default DatasetView;
