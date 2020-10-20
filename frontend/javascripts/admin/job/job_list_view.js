// @flow
import { PropTypes } from "@scalableminds/prop-types";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { Table, Spin, Input, Icon } from "antd";
import { connect } from "react-redux";
import * as React from "react";

import type { APIJob, APIUser } from "admin/api_flow_types";
import { getJobs } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import type { OxalisState } from "oxalis/store";

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
              <Column
                title="Description"
                key="datasetName"
                render={job => `${job.type} of ${job.datasetName}`}
              />
              <Column
                title="Created at"
                key="createdAt"
                render={job => new Date(job.createdAt).toUTCString()}
                sorter={Utils.compareBy(typeHint, job => job.createdAt)}
              />
              <Column
                title="State"
                dataIndex="state"
                key="state"
                sorter={Utils.localeCompareBy(typeHint, job => job.state)}
              />
              <Column
                title="Action"
                key="actions"
                fixed="right"
                width={150}
                render={(__, job: APIJob) => (
                  <span>
                    {job.state === "SUCCESS" && job.datasetName && this.props.activeUser && (
                      <Link
                        to={`/datasets/${this.props.activeUser.organization}/${
                          job.datasetName
                        }/view`}
                        title="View Dataset"
                      >
                        <Icon type="eye-o" />
                        View
                      </Link>
                    )}
                  </span>
                )}
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
