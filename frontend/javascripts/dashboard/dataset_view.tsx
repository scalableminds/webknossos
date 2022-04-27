import React, { useState, useContext, useEffect } from "react";
import { Link, useHistory } from "react-router-dom";
import { Badge, Button, Radio, Col, Dropdown, Input, Menu, Row, Spin, Tooltip, Alert } from "antd";
import {
  CloudUploadOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SettingOutlined,
  InfoCircleOutlined,
  HourglassOutlined,
} from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import type { APIJob, APIMaybeUnimportedDataset, APIUser } from "types/api_flow_types";
import { OptionCard } from "admin/onboarding";
import DatasetTable from "dashboard/advanced_dataset/dataset_table";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import { DatasetCacheContext } from "dashboard/dataset/dataset_cache_provider";
import * as Utils from "libs/utils";
import { CategorizationSearch } from "oxalis/view/components/categorization_label";
import features, { getDemoDatasetUrl } from "features";
import renderIndependently from "libs/render_independently";
import Persistence from "libs/persistence";
import { getJobs } from "admin/admin_rest_api";
import moment from "moment";
import FormattedDate from "components/formatted_date";
import { TOOLTIP_MESSAGES_AND_ICONS } from "admin/job/job_list_view";
import { Unicode } from "oxalis/constants";
const { Search, Group: InputGroup } = Input;
type Props = {
  user: APIUser;
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

function DatasetView(props: Props) {
  const { user } = props;
  const history = useHistory();
  const context = useContext(DatasetCacheContext);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchTags, setSearchTags] = useState<string[]>([]);
  const [datasetFilteringMode, setDatasetFilteringMode] =
    useState<DatasetFilteringMode>("onlyShowReported");
  const [jobs, setJobs] = useState<APIJob[]>([]);

  useEffect(() => {
    const state = persistence.load(history) as PersistenceState;

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
    persistence.persist(history, {
      searchQuery,
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
    setSearchQuery(event.target.value);
  }

  function renderSampleDatasetsModal() {
    renderIndependently((destroy) => (
      <SampleDatasetsModal
        onOk={context.checkDatasets}
        organizationName={user.organization}
        destroy={destroy}
      />
    ));
  }

  function renderPlaceholder() {
    const noDatasetsPlaceholder =
      "There are no datasets available yet. Please ask an admin or dataset manager to upload a dataset or to grant you permissions to add datasets.";
    const addSampleDatasetCard = (
      <OptionCard
        header="Add Sample Dataset"
        icon={<RocketOutlined />}
        action={<Button onClick={renderSampleDatasetsModal}>Add Sample Dataset</Button>}
        height={350}
      >
        This is the easiest way to try out webKnossos. Add one of our sample datasets and start
        exploring in less than a minute.
      </OptionCard>
    );
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
      <React.Fragment>
        <Row gutter={16} justify="center" align="bottom">
          {features().isDemoInstance ? openPublicDatasetCard : addSampleDatasetCard}
          <OptionCard
            header="Upload Dataset"
            icon={<CloudUploadOutlined />}
            action={
              <Link to="/datasets/upload">
                <Button>Open Import Dialog</Button>
              </Link>
            }
            height={350}
          >
            webKnossos supports a variety of{" "}
            <a href="https://docs.webknossos.org/webknossos/data_formats.html">file formats</a> and
            is also able to convert them when necessary.
          </OptionCard>
        </Row>
        <div
          style={{
            marginTop: 24,
          }}
        >
          There are no datasets available yet.
        </div>
      </React.Fragment>
    );
    return context.isLoading ? null : (
      <Row
        justify="center"
        style={{
          padding: "20px 50px 70px",
        }}
        align="middle"
      >
        <Col span={18}>
          <div
            style={{
              paddingBottom: 32,
              textAlign: "center",
            }}
          >
            {Utils.isUserAdminOrDatasetManager(user) ? uploadPlaceholder : noDatasetsPlaceholder}
          </div>
        </Col>
      </Row>
    );
  }

  function renderTable() {
    const filteredDatasets = filterDatasetsForUsersOrganization(context.datasets, user);
    return (
      <DatasetTable
        datasets={filteredDatasets}
        searchQuery={searchQuery}
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

  function renderNewJobsAlert() {
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
                <Tooltip title={tooltip}>{icon}</Tooltip>
                {` ${job.datasetName || "UNKNOWN"}`}
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
          marginTop: 20,
        }}
        showIcon
        icon={<HourglassOutlined />}
      />
    );
  }

  const margin = {
    marginRight: 5,
  };

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'key' implicitly has an 'any' type.
  const createFilteringModeRadio = (key, label) => (
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
      value={searchQuery}
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
  const showLoadingIndicator =
    (context.datasets.length === 0 && context.isLoading) || context.isChecking;
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
              showLoadingIndicator
                ? "Refreshing the dataset list."
                : "Search for new datasets on disk."
            }
          >
            <Button
              icon={showLoadingIndicator ? <LoadingOutlined /> : <ReloadOutlined />}
              style={margin}
              onClick={context.checkDatasets}
            >
              Refresh
            </Button>
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
  const datasets = filterDatasetsForUsersOrganization(context.datasets, user);
  const isEmpty = datasets.length === 0 && datasetFilteringMode !== "onlyShowUnreported";
  const content = isEmpty ? renderPlaceholder() : renderTable();
  return (
    <div>
      {adminHeader}
      <CategorizationSearch
        searchTags={searchTags}
        setTags={setSearchTags}
        localStorageSavingKey={LOCAL_STORAGE_FILTER_TAGS_KEY}
      />
      <div
        className="clearfix"
        style={{
          margin: "20px 0px",
        }}
      />
      {renderNewJobsAlert()}
      <div
        className="clearfix"
        style={{
          margin: "20px 0px",
        }}
      />
      <Spin size="large" spinning={datasets.length === 0 && context.isLoading}>
        {content}
      </Spin>
    </div>
  );
}

export default DatasetView;
