// @flow
import { Badge, Icon, Spin, Table, Card } from "antd";
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

const { Column, ColumnGroup } = Table;

const RELOAD_INTERVAL = 10 * 60 * 1000; // 10 min

const typeHint: APIProjectProgressReport[] = [];

type State = {
  areSettingsVisible: boolean,
  team: ?APITeam,
  data: Array<APIProjectProgressReport>,
  isLoading: boolean,
  updatedAt: ?number,
};

class ProjectProgressReportView extends React.PureComponent<{}, State> {
  state = {
    areSettingsVisible: true,
    data: [],
    team: undefined,
    isLoading: false,
    updatedAt: null,
  };

  async fetchData(suppressLoadingState?: boolean = false) {
    const { team } = this.state;
    if (team == null) {
      this.setState({ data: [] });
    } else if (suppressLoadingState) {
      const errorToastKey = "progress-report-failed-to-refresh";
      try {
        const progessData = await getProjectProgressReport(team.id);
        this.setState({ data: progessData, updatedAt: Date.now() });
        Toast.close(errorToastKey);
      } catch (err) {
        Toast.error(messages["project.report.failed_to_refresh"], {
          sticky: true,
          key: errorToastKey,
        });
      }
    } else {
      this.setState({ isLoading: true });
      const progessData = await getProjectProgressReport(team.id);
      this.setState({ data: progessData, updatedAt: Date.now(), isLoading: false });
    }
  }

  handleTeamChange = (team: APITeam) => {
    this.setState({ team, areSettingsVisible: false }, () => {
      this.fetchData();
    });
  };

  handleOpenSettings = () => {
    this.setState({ areSettingsVisible: true });
  };

  handleReload = () => {
    this.fetchData();
  };

  handleAutoReload = () => {
    this.fetchData(true);
  };

  render() {
    return (
      <div className="container">
        <Loop onTick={this.handleAutoReload} interval={RELOAD_INTERVAL} />
        <div className="pull-right">
          {this.state.updatedAt != null ? <FormattedDate timestamp={this.state.updatedAt} /> : null}{" "}
          <Icon type="setting" onClick={this.handleOpenSettings} />
          <Icon type="reload" onClick={this.handleReload} />
        </div>
        <h3>Project Progress</h3>
        {this.state.areSettingsVisible ? (
          <Card>
            <TeamSelectionForm value={this.state.team} onChange={this.handleTeamChange} />
          </Card>
        ) : null}

        <Spin spinning={this.state.isLoading}>
          <Table
            dataSource={this.state.data}
            pagination={{
              defaultPageSize: 100,
            }}
            rowKey="projectName"
            style={{ marginTop: 30, marginBotton: 30 }}
            size="small"
            className="large-table"
          >
            <Column
              title="Project"
              dataIndex="projectName"
              defaultSortOrder="ascend"
              sorter={Utils.localeCompareBy(typeHint, project => project.projectName)}
              render={(text, item) => (
                <span>
                  {item.paused ? <Icon type="pause-circle-o" /> : null} {text}
                </span>
              )}
            />
            <Column
              title="Tasks"
              dataIndex="totalTasks"
              sorter={Utils.compareBy(typeHint, project => project.totalTasks)}
              render={number => number.toLocaleString()}
            />
            <Column
              title="Priority"
              dataIndex="priority"
              sorter={Utils.compareBy(typeHint, project => project.priority)}
              render={number => number.toLocaleString()}
            />
            <Column
              title="Time [h]"
              dataIndex="billedMilliseconds"
              sorter={Utils.compareBy(typeHint, project => project.billedMilliseconds)}
              render={number =>
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
                sorter={Utils.compareBy(typeHint, project => project.totalInstances)}
                render={number => number.toLocaleString()}
              />
              <Column
                title="Progress"
                key="progress"
                dataIndex="finishedInstances"
                width={100}
                sorter={Utils.compareBy(
                  typeHint,
                  ({ finishedInstances, totalInstances }) => finishedInstances / totalInstances,
                )}
                render={(finishedInstances, item) =>
                  finishedInstances === item.totalInstances ? (
                    <Badge count="100%" style={{ backgroundColor: colors.finished }} />
                  ) : (
                    <span>{Math.floor((100 * finishedInstances) / item.totalInstances)} %</span>
                  )
                }
              />
              <Column
                title={<Badge count="Finished" style={{ background: colors.finished }} />}
                dataIndex="finishedInstances"
                sorter={Utils.compareBy(typeHint, project => project.finishedInstances)}
                render={(text, item) => ({
                  props: {
                    colSpan: 3,
                  },
                  children: (
                    <StackedBarChart
                      a={item.finishedInstances}
                      b={item.activeInstances}
                      c={item.openInstances}
                    />
                  ),
                })}
              />
              <Column
                title={<Badge count="Active" style={{ background: colors.active }} />}
                dataIndex="activeInstances"
                sorter={Utils.compareBy(typeHint, project => project.activeInstances)}
                render={() => ({ props: { colSpan: 0 }, children: null })}
              />
              <Column
                title={<Badge count="Open" style={{ background: colors.open }} />}
                dataIndex="openInstances"
                sorter={Utils.compareBy(typeHint, project => project.openInstances)}
                render={() => ({ props: { colSpan: 0 }, children: null })}
              />
            </ColumnGroup>
          </Table>
        </Spin>
      </div>
    );
  }
}

export default ProjectProgressReportView;
