import { FilterOutlined, PauseCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import AdminPage from "admin/admin_page";
import { getProjectProgressReport } from "admin/rest_api";
import { Badge, Button, Space, Spin, Table } from "antd";
import FormattedDate from "components/formatted_date";
import StackedBarChart, { colors } from "components/stacked_bar_chart";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import { compareBy, localeCompareBy, millisecondsToHours } from "libs/utils";
import messages from "messages";
import { useState } from "react";
import type { APIProjectProgressReport, APITeam } from "types/api_types";

const { Column, ColumnGroup } = Table;
const RELOAD_INTERVAL = 10 * 60 * 1000; // 10 min

function ProjectProgressReportView() {
  const [areSettingsVisible, setAreSettingsVisible] = useState(true);
  const [team, setTeam] = useState<APITeam | undefined>(undefined);

  const {
    data = [],
    isLoading,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useQueryWithErrorHandling(
    {
      queryKey: ["projectProgressReport", team?.id],
      enabled: team != null,
      queryFn: () => getProjectProgressReport(team!.id),
      refetchInterval: RELOAD_INTERVAL,
    },
    messages["project.report.failed_to_refresh"],
  );

  function handleTeamChange(newTeam: APITeam) {
    setTeam(newTeam);
    setAreSettingsVisible(false);
  }

  function handleOpenSettings() {
    setAreSettingsVisible(true);
  }

  return (
    <AdminPage
      title="Project Progress"
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/projects.html"
      description="Monitor project throughput, task instance status, and billed annotation time."
      actions={
        <Space>
          {dataUpdatedAt > 0 ? <FormattedDate timestamp={dataUpdatedAt} /> : null}
          <Button
            icon={<FilterOutlined />}
            variant="outlined"
            onClick={handleOpenSettings}
            disabled={team == null}
          >
            Filter
          </Button>
          <Button
            icon={<ReloadOutlined spin={isFetching} />}
            variant="outlined"
            onClick={() => refetch()}
            disabled={team == null}
          >
            Refresh
          </Button>
        </Space>
      }
      filters={
        areSettingsVisible ? (
          <div style={{ maxWidth: 400 }}>
            <TeamSelectionComponent
              value={team}
              onChange={(selectedTeam) => {
                if (!Array.isArray(selectedTeam) && selectedTeam != null) {
                  handleTeamChange(selectedTeam);
                }
              }}
              prefix={<FilterOutlined />}
            />
          </div>
        ) : null
      }
    >
      <Spin spinning={isLoading}>
        <Table
          dataSource={data}
          pagination={{
            defaultPageSize: 100,
          }}
          rowKey="projectName"
          size="small"
          className="large-table"
        >
          <Column
            title="Project"
            dataIndex="projectName"
            defaultSortOrder="ascend"
            sorter={localeCompareBy<APIProjectProgressReport>((project) => project.projectName)}
            render={(text: string, item: APIProjectProgressReport) => (
              <span>
                {item.paused ? <PauseCircleOutlined /> : null} {text}
              </span>
            )}
          />
          <Column
            title="Tasks"
            dataIndex="totalTasks"
            align="right"
            sorter={compareBy<APIProjectProgressReport>((project) => project.totalTasks)}
            render={(number) => number.toLocaleString()}
          />
          <Column
            title="Priority"
            dataIndex="priority"
            align="right"
            sorter={compareBy<APIProjectProgressReport>((project) => project.priority)}
            render={(number) => number.toLocaleString()}
          />
          <Column
            title="Time [h]"
            dataIndex="billedMilliseconds"
            align="right"
            sorter={compareBy<APIProjectProgressReport>((project) => project.billedMilliseconds)}
            render={(number) =>
              millisecondsToHours(number).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })
            }
          />
          <ColumnGroup title="Instances">
            <Column
              title="Total"
              width={100}
              align="right"
              dataIndex="totalInstances"
              sorter={compareBy<APIProjectProgressReport>((project) => project.totalInstances)}
              render={(number) => number.toLocaleString()}
            />
            <Column
              title="Progress"
              key="progress"
              align="right"
              dataIndex="finishedInstances"
              width={100}
              sorter={compareBy<APIProjectProgressReport>(
                ({ finishedInstances, totalInstances }) => finishedInstances / totalInstances,
              )}
              render={(finishedInstances, item) =>
                finishedInstances === item.totalInstances ? (
                  <Badge
                    count="100%"
                    style={{
                      backgroundColor: colors.finished,
                    }}
                  />
                ) : (
                  <span>{Math.floor((100 * finishedInstances) / item.totalInstances)} %</span>
                )
              }
            />
            <Column
              title={
                <Badge
                  count="Finished"
                  style={{
                    background: colors.finished,
                  }}
                />
              }
              dataIndex="finishedInstances"
              sorter={compareBy<APIProjectProgressReport>((project) => project.finishedInstances)}
              render={(_text, item: APIProjectProgressReport) => ({
                props: {
                  colSpan: 3,
                },
                children: (
                  <StackedBarChart
                    a={item.finishedInstances}
                    b={item.activeInstances}
                    c={item.pendingInstances}
                  />
                ),
              })}
            />
            <Column
              title={
                <Badge
                  count="Active"
                  style={{
                    background: colors.active,
                  }}
                />
              }
              dataIndex="activeInstances"
              sorter={compareBy<APIProjectProgressReport>((project) => project.activeInstances)}
              render={() => ({
                props: {
                  colSpan: 0,
                },
                children: null,
              })}
            />
            <Column
              title={
                <Badge
                  count="Pending"
                  style={{
                    background: colors.open,
                  }}
                />
              }
              dataIndex="pendingInstances"
              sorter={compareBy<APIProjectProgressReport>((project) => project.pendingInstances)}
              render={() => ({
                props: {
                  colSpan: 0,
                },
                children: null,
              })}
            />
          </ColumnGroup>
        </Table>
      </Spin>
    </AdminPage>
  );
}

export default ProjectProgressReportView;
