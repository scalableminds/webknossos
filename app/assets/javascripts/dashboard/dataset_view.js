// @flow

import _ from "lodash";
import * as React from "react";
import { Link, withRouter } from "react-router-dom";
import Utils from "libs/utils";
import moment from "moment";
import { Spin, Input, Button } from "antd";
import AdvancedDatasetView from "dashboard/advanced_dataset/advanced_dataset_view";
import GalleryDatasetView from "dashboard/gallery_dataset_view";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import type { APIUserType, APIDatasetType, APIDataLayerType } from "admin/api_flow_types";
import type { RouterHistory } from "react-router-dom";
import { getDatastores, triggerDatasetCheck, getDatasets } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";

const { Search } = Input;

type Props = {
  dataViewType: "gallery" | "advanced",
  user: APIUserType,
  history: RouterHistory,
};

export type DatasetType = APIDatasetType & {
  hasSegmentation: boolean,
  thumbnailURL: string,
  formattedCreated: string,
};

type State = {
  datasets: Array<DatasetType>,
  searchQuery: string,
  isLoading: boolean,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "datasetList",
);

function createThumbnailURL(datasetName: string, layers: Array<APIDataLayerType>): string {
  const colorLayer = _.find(layers, { category: "color" });
  if (colorLayer) {
    return `/api/datasets/${datasetName}/layers/${colorLayer.name}/thumbnail`;
  }
  return "";
}

export function transformDatasets(datasets: Array<APIDatasetType>): Array<DatasetType> {
  return _.sortBy(
    datasets.map(dataset =>
      Object.assign({}, dataset, {
        hasSegmentation: _.some(
          dataset.dataSource.dataLayers,
          layer => layer.category === "segmentation",
        ),
        thumbnailURL: createThumbnailURL(dataset.name, dataset.dataSource.dataLayers),
        formattedCreated: moment(dataset.created).format("YYYY-MM-DD HH:mm"),
      }),
    ),
    "created",
  );
}

class DatasetView extends React.PureComponent<Props, State> {
  state = {
    datasets: [],
    searchQuery: "",
    isLoading: false,
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const datasets = await getDatasets();
      const transformedDatasets = transformDatasets(datasets);
      this.setState({
        datasets: transformedDatasets,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  handleCheckDatasets = async (): Promise<void> => {
    if (this.state.isLoading) return;

    try {
      this.setState({ isLoading: true });
      const datastores = await getDatastores();
      await Promise.all(datastores.map(datastore => triggerDatasetCheck(datastore.url)));
      await this.fetchData();
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  };

  updateDataset = (newDataset: DatasetType) => {
    const newDatasets = this.state.datasets.map((dataset: DatasetType) => {
      if (dataset.name === newDataset.name) {
        return newDataset;
      }
      return dataset;
    });

    this.setState({
      datasets: newDatasets,
    });
  };

  renderGallery() {
    return (
      <GalleryDatasetView datasets={this.state.datasets} searchQuery={this.state.searchQuery} />
    );
  }

  renderAdvanced() {
    return (
      <AdvancedDatasetView
        datasets={this.state.datasets}
        searchQuery={this.state.searchQuery}
        updateDataset={this.updateDataset}
      />
    );
  }

  render() {
    const isGallery = this.props.dataViewType === "gallery";
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
            Upload Dataset
          </Button>
        </Link>
        {search}
      </div>
    ) : (
      search
    );

    const content = (() => {
      if (isGallery) {
        return this.renderGallery();
      }

      return this.renderAdvanced();
    })();

    return (
      <div>
        {adminHeader}
        <h3 className="TestDatasetHeadline">Datasets</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />
        <Spin size="large" spinning={this.state.isLoading}>
          {content}
        </Spin>
      </div>
    );
  }
}

export default withRouter(DatasetView);
