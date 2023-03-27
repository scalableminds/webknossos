import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Radio,
  Col,
  Dropdown,
  Input,
  Row,
  Spin,
  Tooltip,
  Alert,
  Select,
} from "antd";
import {
  CloudUploadOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  HourglassOutlined,
  SearchOutlined,
} from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import type { APIJob, APIDatasetCompact, APIUser, FolderItem } from "types/api_flow_types";
import { OptionCard } from "admin/onboarding";
import DatasetTable from "dashboard/advanced_dataset/dataset_table";
import * as Utils from "libs/utils";
import { CategorizationSearch } from "oxalis/view/components/categorization_label";
import features, { getDemoDatasetUrl } from "features";
import Persistence from "libs/persistence";
import { getJobs } from "admin/admin_rest_api";
import dayjs from "dayjs";
import FormattedDate from "components/formatted_date";
import { TOOLTIP_MESSAGES_AND_ICONS } from "admin/job/job_list_view";
import { Unicode } from "oxalis/constants";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import { DatasetCollectionContextValue } from "./dataset/dataset_collection_context";
import {
  MINIMUM_SEARCH_QUERY_LENGTH,
  SEARCH_RESULTS_LIMIT,
  useFolderQuery,
} from "./dataset/queries";
import { PricingEnforcedButton } from "components/pricing_enforcers";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { MenuProps } from "rc-menu";
import { ItemType } from "antd/lib/menu/hooks/useItems";

type Props = {
  user: APIUser;
  context: DatasetCollectionContextValue;
  onSelectDataset: (dataset: APIDatasetCompact | null) => void;
  selectedDatasets: APIDatasetCompact[];
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
  return features().isDemoInstance
    ? datasets.filter((d) => d.owningOrganization === user.organization)
    : datasets;
}

const refreshMenuItems: ItemType[] = [
  {
    key: "1",
    label: "Scan disk for new datasets",
  },
];

function DatasetView(props: Props) {
  const { user } = props;
  const context = props.context;
  const searchQuery = context.globalSearchQuery;
  const setSearchQuery = context.setGlobalSearchQuery;
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [datasetFilteringMode, setDatasetFilteringMode] =
    useState<DatasetFilteringMode>("onlyShowReported");
  const [jobs, setJobs] = useState<APIJob[]>([]);
  const { data: folder } = useFolderQuery(context.activeFolderId);

  useEffect(() => {
    const state = persistence.load() as PersistenceState;

    if (state.searchQuery != null) {
      setSearchQuery(state.searchQuery);
    }

    if (state.datasetFilteringMode != null) {
      setDatasetFilteringMode(state.datasetFilteringMode);
    }

    if (features().jobsEnabled) {
      getJobs().then((newJobs) => setJobs(newJobs));
    }
  }, []);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    if (features().jobsEnabled) {
      interval = setInterval(() => {
        getJobs().then((newJobs) => setJobs(newJobs));
      }, CONVERSION_JOBS_REFRESH_INTERVAL);
    }

    return () => (interval != null ? clearInterval(interval) : undefined);
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

  function renderTable(filteredDatasets: APIDatasetCompact[]) {
    return (
      <DatasetTable
        context={props.context}
        datasets={filteredDatasets}
        onSelectDataset={props.onSelectDataset}
        selectedDatasets={props.selectedDatasets}
        searchQuery={searchQuery || ""}
        searchTags={searchTags}
        isUserAdmin={Utils.isUserAdmin(user)}
        isUserDatasetManager={Utils.isUserDatasetManager(user)}
        datasetFilteringMode={datasetFilteringMode}
        updateDataset={context.updateCachedDataset}
        reloadDataset={context.reloadDataset}
        addTagToSearch={addTagToSearch}
      />
    );
  }

  const margin = {
    marginRight: 5,
  };

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

  const isUserAdminOrDatasetManager = Utils.isUserAdminOrDatasetManager(user);
  const isUserAdminOrDatasetManagerOrTeamManager =
    isUserAdminOrDatasetManager || Utils.isUserTeamManager(user);
  const search = isUserAdminOrDatasetManager ? (
    <Input.Group compact style={{ display: "flex" }}>
      {searchBox}
      <Dropdown menu={filterMenu} trigger={["click"]}>
        <Button>
          <Badge dot={datasetFilteringMode !== "showAllDatasets"}>
            <SettingOutlined />
          </Badge>
        </Button>
      </Dropdown>
    </Input.Group>
  ) : (
    searchBox
  );
  const showLoadingIndicator = context.isLoading || context.isChecking;

  const adminHeader = (
    <div
      className="pull-right"
      style={{
        display: "flex",
      }}
    >
      {isUserAdminOrDatasetManagerOrTeamManager ? (
        <React.Fragment>
          <Tooltip
            title={
              showLoadingIndicator ? "Refreshing the dataset list." : "Refresh the dataset list."
            }
          >
            <Dropdown.Button
              menu={{ onClick: context.checkDatasets, items: refreshMenuItems }}
              style={margin}
              onClick={() => context.fetchDatasets()}
              disabled={context.isChecking}
            >
              {showLoadingIndicator ? <LoadingOutlined /> : <ReloadOutlined />} Refresh
            </Dropdown.Button>
          </Tooltip>

          <Link
            to={
              context.activeFolderId != null && (folder == null || folder.isEditable)
                ? `/datasets/upload?to=${context.activeFolderId}`
                : "/datasets/upload"
            }
            style={margin}
          >
            <Button type="primary" icon={<PlusOutlined />}>
              Add Dataset
            </Button>
          </Link>
          {context.activeFolderId != null && (
            <PricingEnforcedButton
              disabled={folder != null && !folder.isEditable}
              style={margin}
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
        </React.Fragment>
      ) : (
        search
      )}
    </div>
  );

  const datasets = context.datasets;
  const filteredDatasets = filterDatasetsForUsersOrganization(datasets, user);

  const isEmpty = datasets.length === 0 && datasetFilteringMode !== "onlyShowUnreported";
  const content = isEmpty
    ? renderPlaceholder(context, user, searchQuery)
    : renderTable(filteredDatasets);

  return (
    <div>
      <RenderToPortal portalId="dashboard-TabBarExtraContent">{adminHeader}</RenderToPortal>

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
          dropdownMatchSelectWidth={false}
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
          <span style={{ color: "var( --ant-text-secondary)", fontSize: 14, marginLeft: 8 }}>
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
        job.type === "convert_to_wkw" &&
        dayjs.duration(now.diff(job.createdAt)).asDays() <= RECENT_DATASET_DAY_THRESHOLD,
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  if (newJobs.length === 0) {
    return null;
  }

  const newJobsHeader = (
    <React.Fragment>
      Recent Dataset Conversions{" "}
      <Tooltip
        title="The conversion of the displayed datasets were started in the last 3 days."
        placement="right"
      >
        <InfoCircleOutlined />
      </Tooltip>
    </React.Fragment>
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
            <Col span={10}>
              <Tooltip title={tooltip}>{icon}</Tooltip>{" "}
              {job.state === "SUCCESS" && job.resultLink ? (
                <Link to={job.resultLink}>{job.datasetName}</Link>
              ) : (
                job.datasetName || "UNKNOWN"
              )}
              {Unicode.NonBreakingSpace}(started at{Unicode.NonBreakingSpace}
              <FormattedDate timestamp={job.createdAt} />
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
        <Col span={10}>
          <Link to="/jobs" title="Jobs Overview">
            See complete list
          </Link>
        </Col>
      </Row>
    </div>
  );
  return (
    <Alert
      message={newJobsHeader}
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
    return searchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH ? "No datasets found." : null;
  }

  const openPublicDatasetCard = (
    <OptionCard
      header="Open Demo Dataset"
      icon={<RocketOutlined />}
      action={
        <a href={getDemoDatasetUrl()} target="_blank" rel="noopener noreferrer">
          <Button>Open Dataset</Button>
        </a>
      }
      height={350}
    >
      Have a look at a public dataset to experience WEBKNOSSOS in action.
    </OptionCard>
  );

  const uploadPlaceholder = (
    <OptionCard
      header="Import Dataset"
      icon={<CloudUploadOutlined />}
      action={
        <Link to="/datasets/upload">
          <Button>Open Import Dialog</Button>
        </Link>
      }
      height={350}
    >
      WEBKNOSSOS supports a variety of (remote){" "}
      <a
        href="https://docs.webknossos.org/webknossos/data_formats.html"
        target="_blank"
        rel="noreferrer"
      >
        file formats
      </a>{" "}
      and is also able to convert them when necessary.
    </OptionCard>
  );

  const emptyListHintText = Utils.isUserAdminOrDatasetManager(user)
    ? "There are no datasets in this folder. Import one or move a dataset from another folder."
    : "There are no datasets in this folder. Please ask an admin or dataset manager to import a dataset or to grant you permissions to add datasets to this folder.";

  return (
    <Row
      justify="center"
      style={{
        padding: "20px 50px 70px",
      }}
      align="middle"
    >
      <Col span={18}>
        <Row gutter={16} justify="center" align="bottom">
          {features().isDemoInstance ? openPublicDatasetCard : null}
          {Utils.isUserAdminOrDatasetManager(user) ? uploadPlaceholder : null}
        </Row>
        <div
          style={{
            marginTop: 24,
            textAlign: "center",
          }}
        >
          {emptyListHintText}
        </div>
      </Col>
    </Row>
  );
}

export default DatasetView;
