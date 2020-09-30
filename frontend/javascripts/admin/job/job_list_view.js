// @flow
import { PropTypes } from "@scalableminds/prop-types";
import { type RouterHistory, withRouter } from "react-router-dom";
import { Table, Icon, Spin, Input, Modal } from "antd";
import * as React from "react";
import _ from "lodash";

import type { APIJob } from "admin/api_flow_types";
import { getJobs, startJob } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import messages from "messages";

const { Column } = Table;
const { Search } = Input;

const typeHint: APIJob[] = [];

type Props = {|
  history: RouterHistory,
|};
type State = {
  isLoading: boolean,
  jobs: Array<APIJob>,
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "jobList",
);

class TeamListView extends React.PureComponent<Props, State> {
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

  async fetchData(): Promise<void> {
    const jobs = await getJobs();
    this.setState({
      isLoading: false,
      jobs: jobs || [],
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  startJob = (job: APIJob) => {
    Modal.confirm({
      title: messages["job.start"],
      onOk: async () => {
        try {
          this.setState({ isLoading: true });
          await startJob(job.datasetName, job.organization);
          this.setState(prevState => ({
            jobs: prevState.jobs.filter(j => j.id !== job.id),
          }));
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
        }
      },
    });
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
                title="Dataset Name"
                dataIndex="datasetName"
                key="datasetName"
                sorter={Utils.localeCompareBy(typeHint, job => job.datasetName)}
              />
              <Column
                title="Organization"
                dataIndex="organization"
                key="organization"
                sorter={Utils.localeCompareBy(typeHint, job => job.organization)}
              />
              <Column
                title="Id"
                dataIndex="id"
                key="id"
                sorter={Utils.localeCompareBy(typeHint, job => job.id)}
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
                render={(__, script: APIJob) => (
                  <a href="#" onClick={_.partial(this.startJob, script)}>
                    <Icon type="start" />
                    Start Job
                  </a>
                )}
              />
            </Table>
          </Spin>
        </div>
      </div>
    );
  }
}

export default withRouter(TeamListView);
