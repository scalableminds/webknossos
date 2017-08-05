// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import React from "react";
import type { APIUserType, APIDatasetType } from "admin/api_flow_types";
import Request from "libs/request";
import Utils from "libs/utils";
import moment from "moment";
import { Input } from "antd";
import SpotlightItemView from "./spotlight_item_view";
import AdvancedDatasetView from "./advanced_dataset/advanced_dataset_view";

const { Search } = Input;

type Props = {
  user: APIUserType,
};

function createThumbnailURL(datasetName, layers) {
  const colorLayer = _.find(layers, { category: "color" });
  if (colorLayer) {
    return `/api/datasets/${datasetName}/layers/${colorLayer.name}/thumbnail`;
  }
  return "";
}

class DatasetView extends React.PureComponent {
  props: Props;
  state: {
    currentDataViewType: "gallery" | "advanced",
    datasets: Array<APIDatasetType>,
    searchQuery: string,
  } = {
    currentDataViewType: "gallery",
    datasets: [],
    searchQuery: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const url = "/api/datasets";
    const datasets = await Request.receiveJSON(url);

    const transformedDatasets = _.sortBy(
      datasets.map(dataset => {
        // since defaults doesn't override null...
        if (dataset.dataSource === null) {
          dataset.dataSource = {
            needsImport: true,
            baseDir: "",
            scale: [],
            dataLayers: [],
          };
        }

        dataset.hasSegmentation = _.some(
          dataset.dataSource.dataLayers,
          layer => layer.category === "segmentation",
        );

        dataset.thumbnailURL = createThumbnailURL(dataset.name, dataset.dataSource.dataLayers);
        dataset.formattedCreated = moment(dataset.created).format("YYYY-MM-DD HH:mm");

        return dataset;
      }),
      "created",
    );

    this.setState({
      datasets: transformedDatasets,
    });
  }

  showAdvancedView = () => this.setState({ currentDataViewType: "advanced" });
  showGalleryView = () => this.setState({ currentDataViewType: "gallery" });

  handleSearch = (event: SyntheticInputEvent): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renderGallery() {
    return (
      <div className="dataset panel panel-default">
        {Utils.filterWithSearchQuery(
          this.state.datasets.filter(ds => ds.isActive),
          ["name", "owningTeam", "description"],
          this.state.searchQuery,
        ).map(ds => <SpotlightItemView dataset={ds} key={ds.name} />)}
      </div>
    );
  }

  renderAdvanced() {
    return (
      <AdvancedDatasetView datasets={this.state.datasets} searchQuery={this.state.searchQuery} />
    );
  }

  render() {
    const isGallery = this.state.currentDataViewType === "gallery";
    const adminHeader = Utils.isUserAdmin(this.props.user)
      ? <div className="pull-right">
          <a href="/datasets/upload" className="btn btn-primary" style={{ marginRight: 5 }}>
            <i className="fa fa-plus" />Add Dataset
          </a>
          {isGallery
            ? <a href="#" className="btn btn-default" onClick={this.showAdvancedView}>
                <i className="fa fa-th-list" />Show advanced view
              </a>
            : <a href="#" className="btn btn-default" onClick={this.showGalleryView}>
                <i className="fa fa-th" />Show gallery view
              </a>}
        </div>
      : null;

    return (
      <div>
        {adminHeader}
        <h3>Datasets</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }}>
          <Search
            style={{ width: 200, float: "right" }}
            onPressEnter={this.handleSearch}
            onChange={this.handleSearch}
          />
        </div>
        <div>
          {isGallery ? this.renderGallery() : this.renderAdvanced()}
        </div>
      </div>
    );
  }
}

export default DatasetView;
