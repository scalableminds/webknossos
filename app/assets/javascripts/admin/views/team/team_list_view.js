// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { Table, Icon, Spin, Button, Input, Modal } from "antd";
import Utils from "libs/utils";
import Request from "libs/request";
import messages from "messages";
import CreateTeamModal from "admin/views/team/create_team_modal_view.js";
import type { APITeamType } from "admin/api_flow_types";

const { Column } = Table;
const { Search } = Input;

type State = {
  isLoading: boolean,
  teams: Array<APITeamType>,
  searchQuery: string,
  isTeamCreationModalVisible: boolean,
};

class TeamListView extends React.PureComponent<{}, State> {
  state = {
    isLoading: true,
    teams: [],
    searchQuery: "",
    isTeamCreationModalVisible: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const url = "/api/teams?isEditable=true";
    const teams = await Request.receiveJSON(url);

    this.setState({
      isLoading: false,
      teams: teams.filter(p => p.owner),
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteTeam = async (script: APITeamType) => {
    Modal.confirm({
      title: messages["team.delete"],
      onOk: () => {
        this.setState({
          isLoading: true,
        });

        const url = `/api/teams/${script.id}`;
        Request.receiveJSON(url, {
          method: "DELETE",
        }).then(() => {
          this.setState({
            isLoading: false,
            teams: this.state.teams.filter(p => p.id !== script.id),
          });
        });
      },
    });
  };

  createTeam = async (newTeam: APITeamType) => {
    this.setState({
      isTeamCreationModalVisible: false,
      teams: this.state.teams.concat([newTeam]),
    });
  };

  render() {
    const marginRight = { marginRight: 20 };

    return (
      <div className="container wide">
        <div style={{ marginTag: 20 }}>
          <div className="pull-right">
            <Button
              icon="plus"
              style={marginRight}
              type="primary"
              onClick={() => this.setState({ isTeamCreationModalVisible: true })}
            >
              Add Team
            </Button>
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
            />
          </div>
          <h3>Teams</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryOR(
                this.state.teams,
                ["name", "owner", "parent"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy("name")}
              />
              <Column
                title="Parent"
                dataIndex="parent"
                key="parent"
                sorter={Utils.localeCompareBy("parent")}
              />
              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy((team: APITeamType) => team.owner.lastName)}
                render={owner =>
                  owner.email ? `${owner.firstName} ${owner.lastName} (${owner.email})` : "-"}
              />
              <Column
                title="Action"
                key="actions"
                render={(__, script: APITeamType) =>
                  <a href="#" onClick={_.partial(this.deleteTeam, script)}>
                    <Icon type="delete" />Delete
                  </a>}
              />
            </Table>
          </Spin>
          <CreateTeamModal
            teams={this.state.teams}
            isVisible={this.state.isTeamCreationModalVisible}
            onOk={this.createTeam}
            onCancel={() => this.setState({ isTeamCreationModalVisible: false })}
          />
        </div>
      </div>
    );
  }
}

export default TeamListView;
