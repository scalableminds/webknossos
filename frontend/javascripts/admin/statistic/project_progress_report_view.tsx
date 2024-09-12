import { Badge, Spin, Table, Card } from "antd";
import { PauseCircleOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import * as React from "react";
import type { APIProjectProgressReport, APITeam } from "types/api_flow_types";
import { getProjectProgressReport } from "admin/admin_rest_api";
import FormattedDate from "components/formatted_date";
import Loop from "components/loop";
import StackedBarChart, { colors } from "components/stacked_bar_chart";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import TeamSelectionForm from "./team_selection_form";
import { useState } from "react";
const { Column, ColumnGroup } = Table;
const RELOAD_INTERVAL = 10 * 60 * 1000; // 10 min

function ProjectProgressReportView() {
  const [areSettingsVisible, setAreSettingsVisible] = useState(true);
  const [data, setData] = useState<APIProjectProgressReport[]>([]);
  const [team, setTeam] = useState<APITeam | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | undefined>(undefined);

  async function fetchData(team: APITeam | undefined, suppressLoadingState: boolean = false) {
    if (team == null) {
      setData([]);
    } else if (suppressLoadingState) {
      const errorToastKey = "progress-report-failed-to-refresh";

      try {
        const progessData = await getProjectProgressReport(team.id);
        setData(progessData);
        setUpdatedAt(Date.now());
        Toast.close(errorToastKey);
      } catch (_err) {
        Toast.error(messages["project.report.failed_to_refresh"], {
          sticky: true,
          key: errorToastKey,
        });
      }
    } else {
      setIsLoading(true);
      const progessData = await getProjectProgressReport(team.id);
      setData(progessData);
      setUpdatedAt(Date.now());
      setIsLoading(false);
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies(fetchData):
  React.useEffect(() => {
    fetchData(team);
  }, [team]);

  function handleTeamChange(newTeam: APITeam) {
    setTeam(newTeam);
    setAreSettingsVisible(false);
  }

  function handleOpenSettings() {
    setAreSettingsVisible(true);
  }

  function handleReload() {
    fetchData(team);
  }

  function handleAutoReload() {
    fetchData(team, true);
  }

  return (
    <div className="container">
      <Loop onTick={handleAutoReload} interval={RELOAD_INTERVAL} />
      <div className="pull-right">
        {updatedAt != null ? <FormattedDate timestamp={updatedAt} /> : null}{" "}
        <SettingOutlined onClick={handleOpenSettings} />
        <ReloadOutlined onClick={handleReload} />
      </div>
      <h3>Project Progress</h3>
      {areSettingsVisible ? (
        <Card>
          <TeamSelectionForm value={team} onChange={handleTeamChange} />
        </Card>
      ) : null}

      <Spin spinning={isLoading}>
        <Table
          dataSource={data}
          pagination={{
            defaultPageSize: 100,
          }}
          rowKey="projectName"
          style={{
            marginTop: 30,
            marginBottom: 30,
          }}
          size="small"
          className="large-table"
        >
          <Column
            title="Project"
            dataIndex="projectName"
            defaultSortOrder="ascend"
            sorter={Utils.localeCompareBy<APIProjectProgressReport>(
              (project) => project.projectName,
            )}
            render={(text: string, item: APIProjectProgressReport) => (
              <span>
                {item.paused ? <PauseCircleOutlined /> : null} {text}
              </span>
            )}
          />
          <Column
            title="Tasks"
            dataIndex="totalTasks"
            sorter={Utils.compareBy<APIProjectProgressReport>((project) => project.totalTasks)}
            render={(number) => number.toLocaleString()}
          />
          <Column
            title="Priority"
            dataIndex="priority"
            sorter={Utils.compareBy<APIProjectProgressReport>((project) => project.priority)}
            render={(number) => number.toLocaleString()}
          />
          <Column
            title="Time [h]"
            dataIndex="billedMilliseconds"
            sorter={Utils.compareBy<APIProjectProgressReport>(
              (project) => project.billedMilliseconds,
            )}
            render={(number) =>
              Utils.millisecondsToHours(number).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              })
            }
          />
          <ColumnGroup title="Instances">
            <Column
              title="Total"
              width={100}
              dataIndex="totalInstances"
              sorter={Utils.compareBy<APIProjectProgressReport>(
                (project) => project.totalInstances,
              )}
              render={(number) => number.toLocaleString()}
            />
            <Column
              title="Progress"
              key="progress"
              dataIndex="finishedInstances"
              width={100}
              sorter={Utils.compareBy<APIProjectProgressReport>(
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
              sorter={Utils.compareBy<APIProjectProgressReport>(
                (project) => project.finishedInstances,
              )}
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
              sorter={Utils.compareBy<APIProjectProgressReport>(
                (project) => project.activeInstances,
              )}
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
              sorter={Utils.compareBy<APIProjectProgressReport>(
                (project) => project.pendingInstances,
              )}
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
    </div>
  );
}

export default ProjectProgressReportView;
