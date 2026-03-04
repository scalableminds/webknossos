import AdminPage from "admin/admin_page";
import { getAvailableTasksReport } from "admin/rest_api";
import { Spin, Table, Tag, Tooltip } from "antd";
import { handleGenericError } from "libs/error_handling";
import { compareBy, localeCompareBy } from "libs/utils";
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
    <AdminPage
      title="Available Task Assignments"
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/tasks.html"
      description={
        <>
          Select a team to show an overview of its users and the number of available task
          assignments they qualify for. Task availability for each user is determined by assigned
          experiences, team memberships, the number of pending task instances, etc. For tasks with
          multiple instances, each user will get at most one. Note that individual tasks may be
          listed as available to multiple users here, but each will only be handed to the first user
          to request it.
        </>
      }
      filters={<TeamSelectionForm onChange={(team) => fetchData(team.id)} />}
    >
      <Spin spinning={isLoading}>
        <Table
          dataSource={data}
          pagination={{
            defaultPageSize: 500,
          }}
          rowKey="id"
          size="small"
          scroll={{
            x: "max-content",
          }}
          className="large-table"
        >
          <Column
            title="User"
            dataIndex="user"
            sorter={localeCompareBy<APIAvailableTasksReport>((task) => task.user)}
            width={200}
          />
          <Column
            title="# Available Tasks"
            dataIndex="totalAvailableTasks"
            defaultSortOrder="ascend"
            sorter={compareBy<APIAvailableTasksReport>((task) => task.totalAvailableTasks)}
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
    </AdminPage>
  );
}

export default AvailableTasksReportView;
