// @flow
import * as React from "react";
import { Spin, Table, Card } from "antd";
import Utils from "libs/utils";
import { getProjectProgressReport } from "admin/admin_rest_api";
import type { APIProjectProgressReportType } from "admin/api_flow_types";
import TeamSelectionForm from "./team_selection_form";

const { Column } = Table;

type State = {
  data: APIProjectProgressReportType,
  isLoading: boolean,
};

class ProjectProgressReportView extends React.PureComponent<{}, State> {
  state = {
    data: [],
    isLoading: false,
  };

  async fetchData(teamId: ?string) {
    if (teamId == null) {
      this.setState({ data: [] });
    } else {
      this.setState({ isLoading: true });
      const progessData = await getProjectProgressReport(teamId);
      this.setState({ data: progessData, isLoading: false });
    }
  }

  render() {
    return (
      <div className="container">
        <h3>Project Progress</h3>

        <Card>
          <TeamSelectionForm onChange={teamId => this.fetchData(teamId)} />
        </Card>

        <Spin spinning={this.state.isLoading}>
          <Table
            dataSource={this.state.data}
            pagination={{
              defaultPageSize: 100,
            }}
            rowKey="projectName"
            style={{ marginTop: 30, marginBotton: 30 }}
          >
            <Column
              title="Project"
              dataIndex="projectName"
              defaultSortOrder="ascend"
              sorter={Utils.localeCompareBy("projectName")}
            />
            <Column title="# Tasks" dataIndex="totalTasks" sorter={Utils.compareBy("totalTasks")} />
            <Column
              title="# Instances"
              dataIndex="totalInstances"
              sorter={Utils.compareBy("totalInstances")}
            />
            <Column
              title="# Open Instances"
              dataIndex="openInstances"
              sorter={Utils.compareBy("openInstances")}
              render={(text, item) =>
                `${item.openInstances} (${Math.round(
                  item.openInstances / item.totalInstances * 100,
                )} %)`
              }
            />
            <Column
              title="# Finished Instances"
              dataIndex="finishedInstances"
              sorter={Utils.compareBy("finishedInstances")}
              render={(text, item) =>
                `${item.finishedInstances} (${Math.round(
                  item.finishedInstances / item.totalInstances * 100,
                )} %)`
              }
            />
            <Column
              title="# In-Progess Instances"
              dataIndex="inProgressInstances"
              sorter={Utils.compareBy("inProgressInstances")}
              render={(text, item) =>
                `${item.inProgressInstances} (${Math.round(
                  item.inProgressInstances / item.totalInstances * 100,
                )} %)`
              }
            />
          </Table>
        </Spin>
      </div>
    );
  }
}

export default ProjectProgressReportView;
