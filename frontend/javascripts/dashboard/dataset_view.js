// @flow

import { Badge, Button, Radio, Col, Dropdown, Icon, Input, Menu, Row, Spin } from "antd";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import React from "react";

import type { APIUser, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import { OptionCard } from "admin/onboarding";
import { getDatastores, triggerDatasetCheck, getDatasets } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import DatasetTable from "dashboard/advanced_dataset/dataset_table";
import Persistence from "libs/persistence";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";
import * as Utils from "libs/utils";
import renderIndependently from "libs/render_independently";
import UserLocalStorage from "libs/user_local_storage";

const { Search, Group: InputGroup } = Input;

type Props = {
  user: APIUser,
  history: RouterHistory,
};

export type DatasetFilteringMode = "showAllDatasets" | "onlyShowReported" | "onlyShowUnreported";

type State = {
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoading: boolean,
  searchQuery: string,
  datasetFilteringMode: DatasetFilteringMode,
};

const persistence: Persistence<State> = new Persistence(
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

export const wkDatasetsCacheKey = "wk.datasets";
export const datasetCache = {
  set(datasets: APIMaybeUnimportedDataset[]): void {
    UserLocalStorage.setItem(wkDatasetsCacheKey, JSON.stringify(datasets));
  },
  get(): APIMaybeUnimportedDataset[] {
    return Utils.parseAsMaybe(UserLocalStorage.getItem(wkDatasetsCacheKey)).getOrElse([]);
  },
  clear(): void {
    UserLocalStorage.removeItem(wkDatasetsCacheKey);
  },
};

class DatasetView extends React.PureComponent<Props, State> {
  state = {
    searchQuery: "",
    datasets: datasetCache.get(),
    isLoading: false,
    datasetFilteringMode: "onlyShowReported",
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchDatasets();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  componentDidCatch(error: Error) {
    console.error(error);
    // An unknown error was thrown. To avoid any problems with the caching of datasets,
    // we simply clear the cache for the datasets and re-fetch.
    this.setState({ datasets: [] });
    datasetCache.clear();
    this.fetchDatasets();
  }

  async fetchDatasets(datasetFilteringMode: ?string): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const selectedFilterOption = datasetFilteringMode || this.state.datasetFilteringMode;
      const mapFilterModeToUnreportedParameter = {
        showAllDatasets: null,
        onlyShowReported: false,
        onlyShowUnreported: true,
      };
      const datasets = await getDatasets(mapFilterModeToUnreportedParameter[selectedFilterOption]);
      datasetCache.set(datasets);

      this.setState({ datasets });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleCheckDatasets = async (): Promise<void> => {
    if (this.state.isLoading) return;

    try {
      this.setState({ isLoading: true });
      const datastores = await getDatastores();
      await Promise.all(
        datastores.filter(ds => !ds.isForeign).map(datastore => triggerDatasetCheck(datastore.url)),
      );
      await this.fetchDatasets();
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  };

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renderSampleDatasetsModal = () => {
    renderIndependently(destroy => (
      <SampleDatasetsModal
        onOk={this.handleCheckDatasets}
        organizationName={this.props.user.organization}
        destroy={destroy}
      />
    ));
  };

  renderPlaceholder() {
    const isUserAdmin = Utils.isUserAdmin(this.props.user);
    const noDatasetsPlaceholder =
      "There are no datasets available yet. Please ask an admin to upload a dataset or to grant you permission to add a dataset.";
    const uploadPlaceholder = (
      <React.Fragment>
        <Row type="flex" gutter={16} justify="center" align="bottom">
          <OptionCard
            header="Add Sample Dataset"
            icon={<Icon type="rocket" />}
            action={
              <Button type="primary" onClick={this.renderSampleDatasetsModal}>
                Add Sample Dataset
              </Button>
            }
            height={350}
          >
            This is the easiest way to try out webKnossos. Add one of our sample datasets and start
            exploring in less than a minute.
          </OptionCard>
          <OptionCard
            header="Upload Dataset"
            icon={<Icon type="cloud-upload-o" />}
            action={
              <Link to="/datasets/upload">
                <Button>Upload your dataset</Button>
              </Link>
            }
            height={250}
          >
            You can also copy it directly onto the hosting server.{" "}
            <a href="https://github.com/scalableminds/webknossos/wiki/Datasets">
              Learn more about supported data formats.
            </a>
          </OptionCard>
        </Row>
        <div style={{ marginTop: 24 }}>There are no datasets available yet.</div>
      </React.Fragment>
    );

    return this.state.isLoading ? null : (
      <Row type="flex" justify="center" style={{ padding: "20px 50px 70px" }} align="middle">
        <Col span={18}>
          <div style={{ paddingBottom: 32, textAlign: "center" }}>
            {isUserAdmin ? uploadPlaceholder : noDatasetsPlaceholder}
          </div>
        </Col>
      </Row>
    );
  }

  renderTable() {
    return (
      <DatasetTable
        datasets={this.state.datasets}
        searchQuery={this.state.searchQuery}
        isUserAdmin={Utils.isUserAdmin(this.props.user)}
        datasetFilteringMode={this.state.datasetFilteringMode}
      />
    );
  }

  render() {
    const margin = { marginRight: 5 };
    const isUserAdmin = Utils.isUserAdmin(this.props.user);
    const createFilteringModeRadio = (key, label) => (
      <Radio
        onChange={() => {
          this.setState({ datasetFilteringMode: key });
          this.fetchDatasets(key);
        }}
        checked={this.state.datasetFilteringMode === key}
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
        style={{ width: 200 }}
        onPressEnter={this.handleSearch}
        onChange={this.handleSearch}
        value={this.state.searchQuery}
      />
    );
    const search = isUserAdmin ? (
      <InputGroup compact>
        {searchBox}
        <Dropdown overlay={filterMenu} trigger={["click"]}>
          <Button>
            <Badge dot={this.state.datasetFilteringMode !== "showAllDatasets"}>
              <Icon type="setting" />
            </Badge>
          </Button>
        </Dropdown>
      </InputGroup>
    ) : (
      searchBox
    );

    const adminHeader = (
      <div className="pull-right" style={{ display: "flex" }}>
        {isUserAdmin ? (
          <React.Fragment>
            <Button
              icon={this.state.isLoading ? "loading" : "reload"}
              style={margin}
              onClick={this.handleCheckDatasets}
            >
              Refresh
            </Button>
            <Link to="/datasets/upload" style={margin}>
              <Button type="primary" icon="plus">
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

    const isEmpty = this.state.datasets.length === 0;
    const content = isEmpty ? this.renderPlaceholder() : this.renderTable();

    return (
      <div>
        {adminHeader}
        <h3 className="TestDatasetHeadline">Datasets</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />

        <Spin size="large" spinning={this.state.datasets.length === 0 && this.state.isLoading}>
          {content}
        </Spin>
      </div>
    );
  }
}

export default withRouter(DatasetView);
