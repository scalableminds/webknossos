// @flow
import * as React from "react";
import { Icon, Spin, Table, Card } from "antd";
import Utils from "libs/utils";
import FormatUtils from "libs/format_utils";
import Loop from "components/loop";
import { getProjectProgressReport } from "admin/admin_rest_api";
import type { APIProjectProgressReportType } from "admin/api_flow_types";
import TeamSelectionForm from "./team_selection_form";

const { Column, ColumnGroup } = Table;

const RELOAD_INTERVAL = 10 * 60 * 1000; // 10 min

type State = {
  areSettingsVisible: boolean,
  teamId: ?string,
  data: Array<APIProjectProgressReportType>,
  isLoading: boolean,
  updatedAt: ?number,
};

class ProjectProgressReportView extends React.PureComponent<{}, State> {
  state = {
    areSettingsVisible: true,
    data: [],
    teamId: undefined,
    isLoading: false,
    updatedAt: null,
  };

  async fetchData(suppressLoadingState?: boolean = false) {
    const { teamId } = this.state;
    if (teamId == null) {
      this.setState({ data: [] });
    } else {
      if (!suppressLoadingState) {
        this.setState({ isLoading: true });
      }
      const progessData = await getProjectProgressReport(teamId);
      this.setState({ data: progessData, updatedAt: Date.now() });
      if (!suppressLoadingState) {
        this.setState({ isLoading: false });
      }
    }
  }

  handleTeamChange = (teamId: string) => {
    this.setState({ teamId, areSettingsVisible: false }, () => {
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
            <TeamSelectionForm value={this.state.teamId} onChange={this.handleTeamChange} />
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
              sorter={Utils.localeCompareBy("projectName")}
              render={(text, item) => (
                <span>
                  {item.paused ? <Icon type="pause" /> : null} {text}
                </span>
              )}
            />
            <Column title="Tasks" dataIndex="totalTasks" sorter={Utils.compareBy("totalTasks")} />
            <ColumnGroup title="Instances">
              <Column
                title="Total"
                dataIndex="totalInstances"
                sorter={Utils.compareBy("totalInstances")}
              />
              <Column
                title="Open"
                dataIndex="openInstances"
                sorter={Utils.compareBy("openInstances")}
                render={(text, item) =>
                  `${item.openInstances} (${Math.round(
                    item.openInstances / item.totalInstances * 100,
                  )} %)`
                }
              />
              <Column
                title="Active"
                dataIndex="inProgressInstances"
                sorter={Utils.compareBy("inProgressInstances")}
                render={(text, item) =>
                  `${item.inProgressInstances} (${Math.round(
                    item.inProgressInstances / item.totalInstances * 100,
                  )} %)`
                }
              />
              <Column
                title="Finished"
                dataIndex="finishedInstances"
                sorter={Utils.compareBy("finishedInstances")}
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
