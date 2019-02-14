// @flow

import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Spin, Input, Button, Icon, Row, Col } from "antd";
import React from "react";

import type { APIUser, APIMaybeUnimportedDataset } from "admin/api_flow_types";
import AdvancedDatasetView from "dashboard/advanced_dataset/advanced_dataset_view";
import PublicationView from "dashboard/publication_view";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import renderIndependently from "libs/render_independently";
import SampleDatasetsModal from "dashboard/dataset/sample_datasets_modal";

const { Search } = Input;

type Props = {
  dataViewType: "gallery" | "advanced",
  user: APIUser,
  history: RouterHistory,
  datasets: Array<APIMaybeUnimportedDataset>,
  isLoading: boolean,
  onCheckDatasets: () => Promise<void>,
};

type State = {
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "datasetList",
);

class DatasetView extends React.PureComponent<Props, State> {
  state = {
    searchQuery: "",
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renderSampleDatasetsModal = () => {
    renderIndependently(destroy => (
      <SampleDatasetsModal
        onClose={this.props.onCheckDatasets}
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
        <p>
          Or add one of our{" "}
          <a href="#" onClick={this.renderSampleDatasetsModal}>
            sample datasets
          </a>
          .
        </p>
      </React.Fragment>
    );

    return this.props.isLoading ? null : (
      <Row type="flex" justify="center" style={{ padding: "20px 50px 70px" }} align="middle">
        <Col span={18}>
          <div style={{ paddingBottom: 32, textAlign: "center" }}>
            {isUserAdmin ? uploadPlaceholder : noDatasetsPlaceholder}
          </div>
        </Col>
      </Row>
    );
  }

  renderGallery() {
    return <PublicationView datasets={this.props.datasets} searchQuery={this.state.searchQuery} />;
  }

  renderAdvanced() {
    return (
      <AdvancedDatasetView
        datasets={this.props.datasets}
        searchQuery={this.state.searchQuery}
        isUserAdmin={Utils.isUserAdmin(this.props.user)}
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
          icon={this.props.isLoading ? "loading" : "reload"}
          style={margin}
          onClick={this.props.onCheckDatasets}
        >
          Refresh
        </Button>
        <Button onClick={this.renderSampleDatasetsModal} style={margin}>
          Add Sample Dataset
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

    const isEmpty = this.props.datasets.length === 0;
    let content;
    if (isEmpty) {
      content = this.renderPlaceholder();
    } else {
      content = isGallery ? this.renderGallery() : this.renderAdvanced();
    }

    return (
      <div>
        {adminHeader}
        <h3 className="TestDatasetHeadline">{isGallery ? "Publications" : "Datasets"}</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />
        <Spin size="large" spinning={this.props.datasets.length === 0 && this.props.isLoading}>
          {content}
        </Spin>
      </div>
    );
  }
}

export default withRouter(DatasetView);
