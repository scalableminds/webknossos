import { InfoCircleOutlined } from "@ant-design/icons";
import { getAvailableTasksReport } from "admin/rest_api";
import { Card, Spin, Table, Tag, Tooltip, Typography } from "antd";
import { handleGenericError } from "libs/error_handling";
import * as Utils from "libs/utils";
import { useState } from "react";
import type { APIAvailableTasksReport } from "types/api_types";
import TeamSelectionForm from "./team_selection_form";

const { Column } = Table;

/*
 * Note that the phrasing “available” tasks is chosen here over “pending” to
 * emphasize that tasks are still available for individual users.
 * From the project viewpoint they are tasks with pending instances.
 */
function AvailableTasksReportView() {
  const [data, setData] = useState<APIAvailableTasksReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  async function fetchData(teamId: string | null | undefined) {
    if (teamId == null) {
      setData([]);
    } else {
      try {
        setIsLoading(true);
        const progressData = await getAvailableTasksReport(teamId);
        setData(progressData);
      } catch (error) {
        handleGenericError(error as Error);
      } finally {
        setIsLoading(false);
      }
    }
  }

  return (
    <div className="container">
      <h3>Available Task Assignments</h3>
      <Typography.Paragraph type="secondary">
        Select a team to show an overview of its users and the number of available task assignments
        they qualify for. Task availability for each user is determined by assigned experiences,
        team memberships, the number of pending task instances, etc. For tasks with multiple
        instances, each user will get at most one. Note that individual tasks may be listed as
        available to multiple users here, but each will only be handed to the first user to request
        it.
        <a
          href="https://docs.webknossos.org/webknossos/tasks_projects/index.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Tooltip title="Read more in the documentation">
            <InfoCircleOutlined style={{ marginLeft: 10 }} />
          </Tooltip>
        </a>
      </Typography.Paragraph>
      <Card>
        <TeamSelectionForm onChange={(team) => fetchData(team.id)} />
      </Card>

      <Spin spinning={isLoading}>
        <Table
          dataSource={data}
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
            sorter={Utils.localeCompareBy<APIAvailableTasksReport>((task) => task.user)}
            width={200}
          />
          <Column
            title="# Available Tasks"
            dataIndex="totalAvailableTasks"
            defaultSortOrder="ascend"
            sorter={Utils.compareBy<APIAvailableTasksReport>((task) => task.totalAvailableTasks)}
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
                          There are potentially {item.availableTasksByProjects[key]} tasks from the
                          project <i>{projectName}</i> available for automatic assignment for this
                          user because they match the configured assignment criteria; especially the
                          required experience level <i>{experience}</i>.
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

export default AvailableTasksReportView;
