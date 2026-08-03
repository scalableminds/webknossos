import { FilterOutlined } from "@ant-design/icons";
import AdminPage from "admin/admin_page";
import { getAvailableTasksReport } from "admin/rest_api";
import { Spin, Table, Tag, Tooltip } from "antd";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import { compareBy, localeCompareBy, scrollToTop } from "libs/utils";
import { useState } from "react";
import type { APIAvailableTasksReport } from "types/api_types";

const { Column } = Table;

/*
 * Note that the phrasing "available" tasks is chosen here over "pending" to
 * emphasize that tasks are still available for individual users.
 * From the project viewpoint they are tasks with pending instances.
 */
function AvailableTasksReportView() {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const { data = [], isLoading } = useQueryWithErrorHandling({
    queryKey: ["availableTasksReport", selectedTeamId],
    enabled: selectedTeamId != null,
    queryFn: () => getAvailableTasksReport(selectedTeamId!),
  });

  return (
    <AdminPage
      title="Available Task Assignments"
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/tasks.html"
      description={
        "Select a team to view available task assignments for its users. Availability depends on experience, team membership, and pending instances. Each task instance is assigned to the first user who requests it."
      }
      filters={
        <div style={{ maxWidth: 400 }}>
          <TeamSelectionComponent
            onChange={(selectedTeam) => {
              if (!Array.isArray(selectedTeam) && selectedTeam != null) {
                setSelectedTeamId(selectedTeam.id);
              }
            }}
            prefix={<FilterOutlined />}
          />
        </div>
      }
    >
      <Spin spinning={isLoading}>
        <Table
          dataSource={data}
          pagination={{
            defaultPageSize: 500,
            onChange: scrollToTop,
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
            align="right"
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
