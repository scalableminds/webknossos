// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import Request from "libs/request";
import Utils from "libs/utils";
import moment from "moment";
import { Spin, Input, Button } from "antd";
import AdvancedDatasetView from "dashboard/views/advanced_dataset/advanced_dataset_view";
import GalleryDatasetView from "dashboard/views/gallery_dataset_view";
import type { APIUserType, APIDatasetType } from "admin/api_flow_types";
import type { DataLayerType } from "oxalis/store";

const { Search } = Input;

type Props = {
  user: APIUserType,
};

export type DatasetType = APIDatasetType & {
  hasSegmentation: boolean,
  thumbnailURL: string,
  formattedCreated: string,
};

type State = {
  currentDataViewType: "gallery" | "advanced",
  datasets: Array<DatasetType>,
  searchQuery: string,
  isLoading: boolean,
};

function createThumbnailURL(datasetName: string, layers: Array<DataLayerType>): string {
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
    currentDataViewType: "gallery",
    datasets: [],
    searchQuery: "",
    isLoading: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const url = "/api/datasets";
    this.setState({ isLoading: true });
    const datasets = await Request.receiveJSON(url);

    const transformedDatasets = transformDatasets(datasets);
    this.setState({
      datasets: transformedDatasets,
      isLoading: false,
    });
  }

  showAdvancedView = () => this.setState({ currentDataViewType: "advanced" });
  showGalleryView = () => this.setState({ currentDataViewType: "gallery" });

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renderGallery() {
    return (
      <GalleryDatasetView datasets={this.state.datasets} searchQuery={this.state.searchQuery} />
    );
  }

  renderAdvanced() {
    return (
      <AdvancedDatasetView datasets={this.state.datasets} searchQuery={this.state.searchQuery} />
    );
  }

  render() {
    const isGallery = this.state.currentDataViewType === "gallery";
    const margin = { marginRight: 5 };
    const search = (
      <Search
        style={{ width: 200, float: "right" }}
        onPressEnter={this.handleSearch}
        onChange={this.handleSearch}
      />
    );

    const adminHeader = Utils.isUserAdmin(this.props.user) ? (
      <div className="pull-right">
        <a href="/datasets/upload" style={margin}>
          <Button type="primary" icon="plus">
            Add Dataset
          </Button>
        </a>
        {isGallery ? (
          <Button onClick={this.showAdvancedView} icon="bars" style={margin}>
            Show Advanced View
          </Button>
        ) : (
          <Button onClick={this.showGalleryView} icon="appstore" style={margin}>
            Show Gallery View
          </Button>
        )}
        {search}
      </div>
    ) : (
      search
    );

    const content = (() => {
      if (this.state.isLoading) {
        return (
          <div className="text-center">
            <Spin size="large" />
          </div>
        );
      }

      if (isGallery) {
        return this.renderGallery();
      }

      return this.renderAdvanced();
    })();

    return (
      <div>
        {adminHeader}
        <h3>Datasets</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />
        <div>{content}</div>
      </div>
    );
  }
}

export default DatasetView;
