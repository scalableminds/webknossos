import {
  EllipsisOutlined,
  HourglassOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { TOOLTIP_MESSAGES_AND_ICONS } from "admin/job/job_list_view";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { getJobs } from "admin/rest_api";
import {
  Alert,
  Badge,
  Button,
  Col,
  Dropdown,
  Input,
  type MenuProps,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Tooltip,
} from "antd";
import type { ItemType } from "antd/es/menu/interface";
import FastTooltip from "components/fast_tooltip";
import FormattedDate from "components/formatted_date";
import { PricingEnforcedButton } from "components/pricing_enforcers";
import DatasetTable from "dashboard/advanced_dataset/dataset_table";
import dayjs from "dayjs";
import features from "features";
import Persistence from "libs/persistence";
import { useWkSelector } from "libs/react_hooks";
import { isUserAdminOrDatasetManager, isUserTeamManager } from "libs/utils";
import type React from "react";
import { Fragment, useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { APIJobCommand, type APIDatasetCompact, type APIJob, type APIUser, type FolderItem } from "types/api_types";
import { Unicode } from "viewer/constants";
import { CategorizationSearch } from "viewer/view/components/categorization_label";
import { RenderToPortal } from "viewer/view/layouting/portal_utils";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";
import type { DatasetCollectionContextValue } from "./dataset/dataset_collection_context";
import {
  MINIMUM_SEARCH_QUERY_LENGTH,
  SEARCH_RESULTS_LIMIT,
  useFolderQuery,
} from "./dataset/queries";

type Props = {
  user: APIUser;
  context: DatasetCollectionContextValue;
  onSelectDataset: (dataset: APIDatasetCompact | null, multiSelect?: boolean) => void;
  onSelectFolder: (folder: FolderItem | null) => void;
  selectedDatasets: APIDatasetCompact[];
  setFolderIdForEditModal: (arg0: string | null) => void;
};
export type DatasetFilteringMode = "showAllDatasets" | "onlyShowReported" | "onlyShowUnreported";
type PersistenceState = {
  searchQuery: string;
  datasetFilteringMode: DatasetFilteringMode;
};
const CONVERSION_JOBS_REFRESH_INTERVAL = 60 * 1000;
const MAX_JOBS_TO_DISPLAY = 5;
const RECENT_DATASET_DAY_THRESHOLD = 3;
const LOCAL_STORAGE_FILTER_TAGS_KEY = "lastDatasetSearchTags";
const persistence = new Persistence<PersistenceState>(
  {
    searchQuery: PropTypes.string,
    datasetFilteringMode: PropTypes.oneOf([
      "showAllDatasets",
      "onlyShowReported",
      "onlyShowUnreported",
    ]),
  },
  "datasetList",
);

function filterDatasetsForUsersOrganization(datasets: APIDatasetCompact[], user: APIUser) {
  return features().isWkorgInstance
    ? datasets.filter((d) => d.owningOrganization === user.organization)
    : datasets;
}

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
  setFolderIdForEditModal,
}: Props) {
  const searchQuery = context.globalSearchQuery;
  const setSearchQuery = context.setGlobalSearchQuery;
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [datasetFilteringMode, setDatasetFilteringMode] =
    useState<DatasetFilteringMode>("onlyShowReported");
  const [jobs, setJobs] = useState<APIJob[]>([]);
  const { data: folder } = useFolderQuery(context.activeFolderId);

  const activeTab = useContext(ActiveTabContext);
  const renderingTab = useContext(RenderingTabContext);

  useEffect(() => {
    const state = persistence.load() as PersistenceState;

    if (state.searchQuery != null) {
      setSearchQuery(state.searchQuery);
    }

    if (state.datasetFilteringMode != null) {
      setDatasetFilteringMode(state.datasetFilteringMode);
    }
  }, [setSearchQuery]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    if (features().jobsEnabled) {
      const poll = () => getJobs(APIJobCommand.CONVERT_TO_WKW, true).then((newJobs) => {
        if (!cancelled) {
          setJobs(newJobs);
        }
      });
      poll();
      interval = setInterval(poll, CONVERSION_JOBS_REFRESH_INTERVAL);
    }

    return () => {
      cancelled = true;
      return (interval != null ? clearInterval(interval) : undefined);
    };
  }, []);

  useEffect(() => {
    persistence.persist({
      searchQuery: searchQuery || "",
      datasetFilteringMode,
    });
  }, [searchQuery, datasetFilteringMode]);

  function addTagToSearch(tag: string) {
    if (!searchTags.includes(tag)) {
      setSearchTags([...searchTags, tag]);
    }
  }

  function handleSearch(event: React.SyntheticEvent<HTMLInputElement>) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
    const value = event.target.value;
    setSearchQuery(value);
  }

  function renderTable(filteredDatasets: APIDatasetCompact[], subfolders: FolderItem[]) {
    return (
      <DatasetTable
        context={context}
        datasets={filteredDatasets}
        subfolders={subfolders}
        onSelectDataset={onSelectDataset}
        selectedDatasets={selectedDatasets}
        searchQuery={searchQuery || ""}
        searchTags={searchTags}
        onSelectFolder={onSelectFolder}
        isUserAdminOrDatasetManager={isUserAdminOrDatasetManager(user)}
        datasetFilteringMode={datasetFilteringMode}
        updateDataset={context.updateCachedDataset}
        reloadDataset={context.reloadDataset}
        addTagToSearch={addTagToSearch}
        setFolderIdForEditModal={setFolderIdForEditModal}
      />
    );
  }

  const createFilteringModeRadio = (key: DatasetFilteringMode, label: string) => (
    <Radio
      onChange={() => {
        setDatasetFilteringMode(key);
      }}
      checked={datasetFilteringMode === key}
    >
      {label}
    </Radio>
  );

  const filterMenu: MenuProps = {
    items: [
      { label: createFilteringModeRadio("showAllDatasets", "Show all datasets"), key: "all" },
      {
        label: createFilteringModeRadio("onlyShowReported", "Only show available datasets"),
        key: "available",
      },
      {
        label: createFilteringModeRadio("onlyShowUnreported", "Only show missing datasets"),
        key: "missing",
      },
    ],
  };

  const searchBox = (
    <Input
      prefix={<SearchOutlined />}
      allowClear
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
  const search = isUserAnAdminOrDatasetManager ? (
    <Space.Compact>
      {searchBox}
      <Dropdown menu={filterMenu} trigger={["click"]}>
        <Button>
          <Badge dot={datasetFilteringMode !== "showAllDatasets"}>
            <SettingOutlined />
          </Badge>
        </Button>
      </Dropdown>
    </Space.Compact>
  ) : (
    searchBox
  );

  const adminHeader = (
    <Space>
      {isUserAdminOrDatasetManagerOrTeamManager ? (
        <Fragment>
          <DatasetRefreshButton context={context} />
          <DatasetAddButton context={context} />
          {context.activeFolderId != null && (
            <PricingEnforcedButton
              disabled={folder != null && !folder.isEditable}
              icon={<PlusOutlined />}
              onClick={() =>
                context.activeFolderId != null &&
                context.showCreateFolderPrompt(context.activeFolderId)
              }
              requiredPricingPlan={PricingPlanEnum.Team}
            >
              Add Folder
            </PricingEnforcedButton>
          )}
          {search}
        </Fragment>
      ) : (
        search
      )}
    </Space>
  );

  const datasets = context.datasets;
  // Don't show subfolders when the search is active
  const subfolders = searchQuery == null ? context.getActiveSubfolders() : [];
  const filteredDatasets = filterDatasetsForUsersOrganization(datasets, user);

  const isEmpty =
    datasets.length === 0 &&
    datasetFilteringMode !== "onlyShowUnreported" &&
    subfolders.length === 0;
  const content = isEmpty
    ? renderPlaceholder(context, user, searchQuery)
    : renderTable(filteredDatasets, subfolders);

  return (
    <div>
      <RenderToPortal portalId="dashboard-TabBarExtraContent">
        {activeTab === renderingTab ? adminHeader : null}
      </RenderToPortal>
      {searchQuery && (
        <GlobalSearchHeader
          searchQuery={searchQuery}
          isEmpty={isEmpty}
          filteredDatasets={filteredDatasets}
          context={context}
        />
      )}

      <CategorizationSearch
        itemName="datasets"
        searchTags={searchTags}
        setTags={setSearchTags}
        localStorageSavingKey={LOCAL_STORAGE_FILTER_TAGS_KEY}
      />
      <NewJobsAlert jobs={jobs} />
      <Spin size="large" spinning={datasets.length === 0 && context.isLoading}>
        {content}
      </Spin>
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
        <Button onClick={() => context.fetchDatasets()} disabled={context.isChecking}>
          {showLoadingIndicator ? <LoadingOutlined /> : <ReloadOutlined />} Refresh
        </Button>
      </FastTooltip>
      <Dropdown
        menu={{ onClick: () => context.checkDatasets(organizationId), items: refreshMenuItems }}
      >
        <Button disabled={context.isChecking}>
          <EllipsisOutlined />
        </Button>
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
  filteredDatasets,
  isEmpty,
  context,
}: {
  searchQuery: string;
  filteredDatasets: APIDatasetCompact[];
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
      <p>Enter at least {MINIMUM_SEARCH_QUERY_LENGTH} characters to search</p>
    ) : null;
  }

  return (
    <>
      <div style={{ float: "right" }}>
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
      <h3>
        <SearchOutlined />
        Search Results for &quot;{searchQuery}&quot;
        {filteredDatasets.length === SEARCH_RESULTS_LIMIT ? (
          <span style={{ color: "var( --ant-color-text-secondary)", fontSize: 14, marginLeft: 8 }}>
            (only showing the first {SEARCH_RESULTS_LIMIT} results)
          </span>
        ) : null}
      </h3>
    </>
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

function renderPlaceholder(
  context: DatasetCollectionContextValue,
  user: APIUser,
  searchQuery: string | null,
) {
  if (context.isLoading) {
    // A spinner is rendered by the parent above this component which is
    // why a height is necessary to avoid the spinner sticking to the top
    // (and being cropped).
    return <div style={{ height: 200 }} />;
  }

  if (searchQuery) {
    return searchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH
      ? "No datasets match your search."
      : null;
  }

  const emptyListHintText = isUserAdminOrDatasetManager(user)
    ? "There are no datasets in this folder. Import one or move a dataset from another folder."
    : "There are no datasets in this folder. Please ask an admin or dataset manager to import a dataset or to grant you permissions to add datasets to this folder.";

  return (
    <div
      style={{
        marginTop: 24,
        textAlign: "center",
      }}
    >
      {emptyListHintText}
    </div>
  );
}

export default DatasetView;
