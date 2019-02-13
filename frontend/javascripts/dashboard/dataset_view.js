// @flow

import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Spin, Input, Button, Icon, Row, Col } from "antd";
import * as React from "react";

import type { APIUser, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import AdvancedDatasetView from "dashboard/advanced_dataset/dataset_table";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import { getDatastores, triggerDatasetCheck, getDatasets } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";

const { Search } = Input;

type Props = {
  user: APIUser,
  history: RouterHistory,
};

type State = {
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoading: boolean,
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "datasetList",
);

export const wkDatasetsCacheKey = "wk.datasets";
export const datasetCache = {
  set(datasets: APIMaybeUnimportedDataset[]): void {
    localStorage.setItem(wkDatasetsCacheKey, JSON.stringify(datasets));
  },
  get(): APIMaybeUnimportedDataset[] {
    return Utils.parseAsMaybe(localStorage.getItem(wkDatasetsCacheKey)).getOrElse([]);
  },
  clear(): void {
    localStorage.removeItem(wkDatasetsCacheKey);
  },
};

class DatasetView extends React.PureComponent<Props, State> {
  state = {
    searchQuery: "",
    datasets: datasetCache.get(),
    isLoading: false,
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

  async fetchDatasets(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const datasets = await getDatasets();
      datasetCache.set(datasets);

      // todo: before setting datasets here, replace the LRU counts by the old ones
      // datasets.forEach(dataset => {

      // })

      this.setState({
        datasets,
      });
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

  renderPlaceholder() {
    const isUserAdmin = Utils.isUserAdmin(this.props.user);
    const noDatasetsPlaceholder =
      "There are no datasets available yet. Please ask an admin to upload a dataset or to grant you permission to add a dataset.";
    const uploadPlaceholder = (
      <React.Fragment>
        <Icon type="cloud-upload" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
        <p style={{ fontSize: 24, margin: "14px 0 0" }}>Upload the first dataset.</p>
        <p
          style={{
            fontSize: 14,
            margin: "14px 0",
            color: "gray",
            display: "inline-block",
            width: 500,
          }}
        >
          <Link to="/datasets/upload">Upload your dataset</Link> or copy it directly onto the
          hosting server.{" "}
          <a href="https://github.com/scalableminds/webknossos/wiki/Datasets">
            Learn more about supported data formats.
          </a>
        </p>
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
      <AdvancedDatasetView
        datasets={this.state.datasets}
        searchQuery={this.state.searchQuery}
        isUserAdmin={Utils.isUserAdmin(this.props.user)}
      />
    );
  }

  render() {
    const margin = { marginRight: 5 };
    const search = (
      <Search
        style={{ width: 200, float: "right" }}
        onPressEnter={this.handleSearch}
        onChange={this.handleSearch}
        value={this.state.searchQuery}
      />
    );

    const adminHeader = Utils.isUserAdmin(this.props.user) ? (
      <div className="pull-right">
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
      </div>
    ) : (
      search
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
