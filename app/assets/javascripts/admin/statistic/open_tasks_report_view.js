// @flow
import * as React from "react";
import { Spin, Table, Card } from "antd";
import Utils from "libs/utils";
import { getOpenTasksReport } from "admin/admin_rest_api";
import type { APIOpenTasksReportType } from "admin/api_flow_types";
import { handleGenericError } from "libs/error_handling";
import TeamSelectionForm from "./team_selection_form";

const { Column } = Table;

const typeHint: APIOpenTasksReportType[] = [];

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
      try {
        this.setState({ isLoading: true });
        const progressData = await getOpenTasksReport(teamId);
        this.setState({ data: progressData });
      } catch (error) {
        handleGenericError(error);
      } finally {
        this.setState({ isLoading: false });
      }
    }
  }

  render() {
    return (
      <div className="container">
        <h3>Open Tasks</h3>

        <Card>
          <TeamSelectionForm onChange={team => this.fetchData(team.id)} />
        </Card>

        <Spin spinning={this.state.isLoading}>
          <Table
            dataSource={this.state.data}
            pagination={{
              defaultPageSize: 500,
            }}
            rowKey="id"
            style={{ marginTop: 30, marginBotton: 30 }}
            size="small"
          >
            <Column
              title="User"
              dataIndex="user"
              sorter={Utils.localeCompareBy(typeHint, "user")}
              width={200}
            />
            <Column
              title="# Assignments"
              dataIndex="totalAssignments"
              defaultSortOrder="ascend"
              sorter={Utils.compareBy(typeHint, "totalAssignments")}
              width={150}
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
