// @flow
import * as React from "react";
import { Spin, Table, Card } from "antd";
import Utils from "libs/utils";
import { getOpenTasksReport } from "admin/admin_rest_api";
import type { APIOpenTasksReportType } from "admin/api_flow_types";
import TeamSelectionForm from "./team_selection_form";

const { Column } = Table;

type State = {
  data: Array<APIOpenTasksReportType>,
  isLoading: boolean,
};

class OpenTasksReportView extends React.PureComponent<{}, State> {
  state = {
    data: [],
    isLoading: false,
  };

  async fetchData(teamId: ?string) {
    if (teamId == null) {
      this.setState({ data: [] });
    } else {
      this.setState({ isLoading: true });
      const progessData = await getOpenTasksReport(teamId);
      this.setState({ data: progessData, isLoading: false });
    }
  }

  render() {
    return (
      <div className="container">
        <h3>Open Tasks</h3>

        <Card>
          <TeamSelectionForm onChange={teamId => this.fetchData(teamId)} />
        </Card>

        <Spin spinning={this.state.isLoading}>
          <Table
            dataSource={this.state.data}
            pagination={{
              defaultPageSize: 100,
            }}
            rowKey="user"
            style={{ marginTop: 30, marginBotton: 30 }}
          >
            <Column
              title="User"
              dataIndex="user"
              defaultSortOrder="ascend"
              sorter={Utils.localeCompareBy("user")}
            />
            <Column
              title="# Assignments"
              dataIndex="totalAssignments"
              sorter={Utils.compareBy("totalAssignments")}
            />
            <Column
              title=""
              key="content"
              render={(text, item) =>
                Object.keys(item.assignmentsByProjects)
                  .map(key => `${key} (${item.assignmentsByProjects[key]})`)
                  .join(", ")
              }
            />
          </Table>
        </Spin>
      </div>
    );
  }
}

export default OpenTasksReportView;
