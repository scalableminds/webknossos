import { Spin, Table, Card, Typography, Tooltip, Tag } from "antd";
import * as React from "react";
import type { APIAvailableTasksReport } from "types/api_flow_types";
import { getAvailableTasksReport } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import * as Utils from "libs/utils";
import TeamSelectionForm from "./team_selection_form";
import { InfoCircleOutlined } from "@ant-design/icons";
import { EmptyObject } from "types/globals";

const { Column } = Table;
const typeHint: APIAvailableTasksReport[] = [];
type State = {
  data: Array<APIAvailableTasksReport>;
  isLoading: boolean;
};

/*
 * Note that the phrasing “available” tasks is chosen here over “pending” to
 * emphasize that tasks are still available for individual users.
 * From the project viewpoint they are tasks with pending instances.
 */
class AvailableTasksReportView extends React.PureComponent<EmptyObject, State> {
  state: State = {
    data: [],
    isLoading: false,
  };

  async fetchData(teamId: string | null | undefined) {
    if (teamId == null) {
      this.setState({
        data: [],
      });
    } else {
      try {
        this.setState({
          isLoading: true,
        });
        const progressData = await getAvailableTasksReport(teamId);
        this.setState({
          data: progressData,
        });
      } catch (error) {
        handleGenericError(error as Error);
      } finally {
        this.setState({
          isLoading: false,
        });
      }
    }
  }

  render() {
    return (
      <div className="container">
        <h3>Available Task Assignments</h3>
        <Typography.Paragraph type="secondary">
          Select a team to show an overview of its users and the number of available task assigments
          they qualify for. Task availability for each user is determined by assigned experiences,
          team memberships, the number of pending task instances, etc. For tasks with multiple
          instances, each user will get at most one. Note that individual tasks may be listed as
          available to multiple users here, but each will only be handed to the first user to
          request it.
          <a
            href="https://docs.webknossos.org/webknossos/tasks.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Tooltip title="Read more in the documentation">
              <InfoCircleOutlined style={{ marginLeft: 10 }} />
            </Tooltip>
          </a>
        </Typography.Paragraph>
        <Card>
          <TeamSelectionForm onChange={(team) => this.fetchData(team.id)} />
        </Card>

        <Spin spinning={this.state.isLoading}>
          <Table
            dataSource={this.state.data}
            pagination={{
              defaultPageSize: 500,
            }}
            rowKey="id"
            style={{
              marginTop: 30,
              marginBottom: 30,
            }}
            size="small"
            scroll={{
              x: "max-content",
            }}
            className="large-table"
          >
            <Column
              title="User"
              dataIndex="user"
              sorter={Utils.localeCompareBy(typeHint, (task) => task.user)}
              width={200}
            />
            <Column
              title="# Available Tasks"
              dataIndex="totalAvailableTasks"
              defaultSortOrder="ascend"
              sorter={Utils.compareBy(typeHint, (task) => task.totalAvailableTasks)}
              width={150}
            />
            <Column
              title="Available Tasks by Project"
              key="content"
              render={(_text, item: APIAvailableTasksReport) =>
                Object.keys(item.availableTasksByProjects).map((key) => {
                  const [projectName, experience] = key.split("/");
                  return (
                    <div key={key}>
                      <Tooltip
                        title={
                          <span>
                            There are potentially {item.availableTasksByProjects[key]} tasks from
                            the project <i>{projectName}</i> available for automatic assignment for
                            this user because they match the configured assignment criteria;
                            especially the required experience level <i>{experience}</i>.
                          </span>
                        }
                      >
                        {projectName}: {item.availableTasksByProjects[key]}
                      </Tooltip>
                      <Tag style={{ marginLeft: 6 }}>{experience}</Tag>
                    </div>
                  );
                })
              }
            />
          </Table>
        </Spin>
      </div>
    );
  }
}

export default AvailableTasksReportView;
