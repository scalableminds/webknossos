// @flow
import _ from "lodash";

import { PropTypes } from "@scalableminds/prop-types";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { Table, Spin, Input, Icon, Tooltip } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import type { APIJob, APIUser } from "types/api_flow_types";
import { getJobs } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import type { OxalisState } from "oxalis/store";
import FormattedDate from "components/formatted_date";

const refreshInterval = 5000;

const { Column } = Table;
const { Search } = Input;

const typeHint: APIJob[] = [];

type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = { ...StateProps, history: RouterHistory };

type State = {
  isLoading: boolean,
  jobs: Array<APIJob>,
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "jobList",
);

class JobListView extends React.PureComponent<Props, State> {
  intervalID: ?TimeoutID;

  state = {
    isLoading: true,
    jobs: [],
    searchQuery: "",
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

  componentWillUnmount() {
    if (this.intervalID != null) {
      clearTimeout(this.intervalID);
    }
  }

  async fetchData(): Promise<void> {
    const jobs = await getJobs();
    this.setState(
      {
        isLoading: false,
        jobs,
      },
      // refresh jobs according to the refresh interval
      () => {
        this.intervalID = setTimeout(this.fetchData.bind(this), refreshInterval);
      },
    );
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  renderDescription = (__: Any, job: APIJob) => {
    if (job.type === "tiff_cubing") {
      return <span>{`Tiff to WKW conversion of ${job.datasetName}`}</span>;
    } else if (job.type === "export_tiff") {
      return (
        <span>
          Tiff export from {job.layerName} layer of{" "}
          <Link to={`/datasets/${job.organizationName}/${job.datasetName}/view`}>
            {job.datasetName}
          </Link>
        </span>
      );
    }
  };

  renderActions = (__: Any, job: APIJob) => {
    if (job.type === "tiff_cubing") {
      return (
        <span>
          {job.state === "SUCCESS" && job.datasetName && this.props.activeUser && (
            <Link
              to={`/datasets/${this.props.activeUser.organization}/${job.datasetName}/view`}
              title="View Dataset"
            >
              <Icon type="eye-o" />
              View
            </Link>
          )}
        </span>
      );
    } else if (job.type === "export_tiff") {
      return (
        <span>
          {job.state === "SUCCESS" && job.exportFileName && this.props.activeUser && (
            <a href={`/api/jobs/${job.id}/downloadExport/${job.exportFileName}`} title="Download">
              <Icon type="download" />
              Download
            </a>
          )}
        </span>
      );
    } else return null;
  };

  renderState = (__: Any, job: APIJob) => {
    const stateString = _.capitalize(job.state.toLowerCase());
    if (job.state === "SUCCESS") return stateString;
    else {
      return (
        <Tooltip
          title={
            "Something whent wrong when executing this job. Feel free to contact us if you need assistance."
          }
        >
          {stateString}
        </Tooltip>
      );
    }
  };

  render() {
    return (
      <div className="container">
        <div style={{ marginTag: 20 }}>
          <div className="pull-right">
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
              value={this.state.searchQuery}
            />
          </div>
          <h3>Jobs</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryAND(
                this.state.jobs,
                ["datasetName"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Column
                title="Job Id"
                dataIndex="id"
                key="id"
                sorter={Utils.localeCompareBy(typeHint, job => job.id)}
              />
              <Column title="Description" key="datasetName" render={this.renderDescription} />
              <Column
                title="Created at"
                key="createdAt"
                render={job => <FormattedDate timestamp={job.createdAt} />}
                sorter={Utils.compareBy(typeHint, job => job.createdAt)}
              />
              <Column
                title="State"
                key="state"
                render={this.renderState}
                sorter={Utils.localeCompareBy(typeHint, job => job.state)}
              />
              <Column
                title="Action"
                key="actions"
                fixed="right"
                width={150}
                render={this.renderActions}
              />
            </Table>
          </Spin>
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<StateProps, {||}, _, _, _, _>(mapStateToProps)(withRouter(JobListView));
