// @flow
import * as React from "react";
import { Icon, Spin, Table, Card } from "antd";
import Utils from "libs/utils";
import FormatUtils from "libs/format_utils";
import Loop from "components/loop";
import { getProjectProgressReport } from "admin/admin_rest_api";
import type { APIProjectProgressReportType, APITeamType } from "admin/api_flow_types";
import TeamSelectionForm from "./team_selection_form";

const { Column, ColumnGroup } = Table;

const RELOAD_INTERVAL = 10 * 60 * 1000; // 10 min

const typeHint: APIProjectProgressReportType[] = [];

type State = {
  areSettingsVisible: boolean,
  team: ?APITeamType,
  data: Array<APIProjectProgressReportType>,
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
      try {
        const progessData = await getProjectProgressReport(team.id);
        this.setState({ data: progessData, updatedAt: Date.now() });
      } catch (err) {
        // Fail silently
      }
    } else {
      this.setState({ isLoading: true });
      const progessData = await getProjectProgressReport(team.id);
      this.setState({ data: progessData, updatedAt: Date.now(), isLoading: false });
    }
  }

  handleTeamChange = (team: APITeamType) => {
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
          {this.state.updatedAt != null ? FormatUtils.formatDate(this.state.updatedAt) : null}{" "}
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
          >
            <Column
              title="Project"
              dataIndex="projectName"
              defaultSortOrder="ascend"
              sorter={Utils.localeCompareBy(typeHint, "projectName")}
              render={(text, item) => (
                <span>
                  {item.paused ? <Icon type="pause-circle-o" /> : null} {text}
                </span>
              )}
            />
            <Column
              title="Tasks"
              dataIndex="totalTasks"
              sorter={Utils.compareBy(typeHint, "totalTasks")}
            />
            <ColumnGroup title="Instances">
              <Column
                title="Total"
                dataIndex="totalInstances"
                sorter={Utils.compareBy(typeHint, "totalInstances")}
              />
              <Column
                title="Open"
                dataIndex="openInstances"
                sorter={Utils.compareBy(typeHint, "openInstances")}
                render={(text, item) =>
                  `${item.openInstances} (${Math.round(
                    item.openInstances / item.totalInstances * 100,
                  )} %)`
                }
              />
              <Column
                title="Active"
                dataIndex="activeInstances"
                sorter={Utils.compareBy(typeHint, "activeInstances")}
                render={(text, item) =>
                  `${item.activeInstances} (${Math.round(
                    item.activeInstances / item.totalInstances * 100,
                  )} %)`
                }
              />
              <Column
                title="Finished"
                dataIndex="finishedInstances"
                sorter={Utils.compareBy(typeHint, "finishedInstances")}
                render={(text, item) =>
                  `${item.finishedInstances} (${Math.round(
                    item.finishedInstances / item.totalInstances * 100,
                  )} %)`
                }
              />
            </ColumnGroup>
          </Table>
        </Spin>
      </div>
    );
  }
}

export default ProjectProgressReportView;
