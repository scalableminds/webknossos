import React, { useState, useContext, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Radio,
  Col,
  Dropdown,
  Input,
  Menu,
  Row,
  Spin,
  Tooltip,
  Alert,
  MenuProps,
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
import type { APIJob, APIMaybeUnimportedDataset, APIUser } from "types/api_flow_types";
import { OptionCard } from "admin/onboarding";
import DatasetTable from "dashboard/advanced_dataset/dataset_table";
import { DatasetCacheContextValue } from "dashboard/dataset/dataset_cache_provider";
import * as Utils from "libs/utils";
import { CategorizationSearch } from "oxalis/view/components/categorization_label";
import features, { getDemoDatasetUrl } from "features";
import Persistence from "libs/persistence";
import { getJobs } from "admin/admin_rest_api";
import moment from "moment";
import FormattedDate from "components/formatted_date";
import { TOOLTIP_MESSAGES_AND_ICONS } from "admin/job/job_list_view";
import { Unicode } from "oxalis/constants";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";
import { DatasetCollectionContextValue } from "./dataset/dataset_collection_context";
import { MINIMUM_SEARCH_QUERY_LENGTH, SEARCH_RESULTS_LIMIT } from "./dataset/queries";

const { Search, Group: InputGroup } = Input;

type Props = {
  user: APIUser;
  context: DatasetCacheContextValue | DatasetCollectionContextValue;
  onSelectDataset?: (dataset: APIMaybeUnimportedDataset | null) => void;
  selectedDataset?: APIMaybeUnimportedDataset | null | undefined;
  hideDetailsColumns: boolean;
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

function filterDatasetsForUsersOrganization(datasets: APIMaybeUnimportedDataset[], user: APIUser) {
  return features().isDemoInstance
    ? datasets.filter((d) => d.owningOrganization === user.organization)
    : datasets;
}

const refreshMenuItems = [
  {
    key: "1",
    label: "Refresh from disk",
  },
];

function DatasetView(props: Props) {
  const { user } = props;
  const activeTab = useContext(ActiveTabContext);
  const renderingTab = useContext(RenderingTabContext);

  const context = props.context;
  const searchQuery = context.globalSearchQuery;
  const setSearchQuery = context.setGlobalSearchQuery;
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [datasetFilteringMode, setDatasetFilteringMode] =
    useState<DatasetFilteringMode>("onlyShowReported");
  const [jobs, setJobs] = useState<APIJob[]>([]);

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

    context.fetchDatasets({
      applyUpdatePredicate: (_newDatasets) => {
        // Only update the datasets when there are none currently.
        // This avoids sudden changes in the dataset table (since
        // a cached version is already shown). As a result, the
        // dataset list is outdated a bit (shows the list of the
        // last page load). Since a simple page refresh (or clicking
        // the Refresh button) will show a newer version, this is acceptable.
        const updateDatasets = context.datasets.length === 0;
        return updateDatasets;
      },
    });
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

  function renderTable(filteredDatasets: APIMaybeUnimportedDataset[]) {
    return (
      <DatasetTable
        datasets={filteredDatasets}
        onSelectDataset={props.onSelectDataset}
        selectedDataset={props.selectedDataset}
        searchQuery={searchQuery || ""}
        searchTags={searchTags}
        isUserAdmin={Utils.isUserAdmin(user)}
        isUserDatasetManager={Utils.isUserDatasetManager(user)}
        datasetFilteringMode={datasetFilteringMode}
        updateDataset={context.updateCachedDataset}
        reloadDataset={context.reloadDataset}
        addTagToSearch={addTagToSearch}
        hideDetailsColumns={props.hideDetailsColumns}
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
        context.fetchDatasets({
          datasetFilteringMode: key,
        });
      }}
      checked={datasetFilteringMode === key}
    >
      {label}
    </Radio>
  );

  const filterMenu = (
    <Menu onClick={() => {}}>
      <Menu.Item>{createFilteringModeRadio("showAllDatasets", "Show all datasets")}</Menu.Item>
      <Menu.Item>
        {createFilteringModeRadio("onlyShowReported", "Only show available datasets")}
      </Menu.Item>
      <Menu.Item>
        {createFilteringModeRadio("onlyShowUnreported", "Only show missing datasets")}
      </Menu.Item>
    </Menu>
  );
  const searchBox = (
    <Search
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
    <InputGroup compact>
      {searchBox}
      <Dropdown overlay={filterMenu} trigger={["click"]}>
        <Button>
          <Badge dot={datasetFilteringMode !== "showAllDatasets"}>
            <SettingOutlined />
          </Badge>
        </Button>
      </Dropdown>
    </InputGroup>
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
              overlay={<Menu onClick={context.checkDatasets} items={refreshMenuItems} />}
              style={margin}
              onClick={() => context.fetchDatasets()}
              disabled={context.isChecking}
            >
              {showLoadingIndicator ? <LoadingOutlined /> : <ReloadOutlined />} Refresh
            </Dropdown.Button>
          </Tooltip>
          <Link to="/datasets/upload" style={margin}>
            <Button type="primary" icon={<PlusOutlined />}>
              Add Dataset
            </Button>
          </Link>
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
      {activeTab === renderingTab && (
        <RenderToPortal portalId="dashboard-TabBarExtraContent">{adminHeader}</RenderToPortal>
      )}
      {searchQuery &&
        // Render a header for the search.
        (searchQuery.length >= MINIMUM_SEARCH_QUERY_LENGTH ? (
          <h3>
            <SearchOutlined /> Search Results for &quot;{searchQuery}&quot;
            {filteredDatasets.length === SEARCH_RESULTS_LIMIT ? (
              <span style={{ color: "var( --ant-text-secondary)", fontSize: 14, marginLeft: 8 }}>
                (only showing the first {SEARCH_RESULTS_LIMIT} results)
              </span>
            ) : null}
          </h3>
        ) : (
          // No results are shown because the search query is too short
          isEmpty && <p>Enter at least {MINIMUM_SEARCH_QUERY_LENGTH} characters to search</p>
        ))}
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

function NewJobsAlert({ jobs }: { jobs: APIJob[] }) {
  const now = moment();
  const newJobs = jobs
    .filter(
      (job) =>
        job.type === "convert_to_wkw" &&
        moment.duration(now.diff(job.createdAt)).asDays() <= RECENT_DATASET_DAY_THRESHOLD,
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
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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
  context: DatasetCacheContextValue | DatasetCollectionContextValue,
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
      ? "No datasets found. All folders have been searched."
      : null;
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
      Have a look at a public dataset to experience webKnossos in action.
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
      webKnossos supports a variety of (remote){" "}
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

  let emptyListHintText;

  if (context.supportsFolders) {
    emptyListHintText = Utils.isUserAdminOrDatasetManager(user)
      ? "There are no datasets in this folder. Import one or move a dataset from another folder."
      : "There are no datasets in this folder. Please ask an admin or dataset manager to import a dataset or to grant you permissions to add datasets to this folder.";
  } else {
    emptyListHintText = Utils.isUserAdminOrDatasetManager(user)
      ? "There are no datasets available yet. Import one or try a public demo dataset."
      : "There are no datasets available yet. Please ask an admin or dataset manager to import a dataset or to grant you permissions to add datasets.";
  }

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
