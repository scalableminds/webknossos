// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { Table, Icon, Spin, Button, Input, Modal } from "antd";
import Utils from "libs/utils";
import messages from "messages";
import CreateTeamModal from "admin/views/team/create_team_modal_view.js";
import { getEditableTeams, deleteTeam } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import { PropTypes } from "prop-types";
import { withRouter } from "react-router-dom";
import type { APITeamType } from "admin/api_flow_types";
import type { RouterHistory } from "react-router-dom";

const { Column } = Table;
const { Search } = Input;

type Props = {
  history: RouterHistory,
};

type State = {
  isLoading: boolean,
  teams: Array<APITeamType>,
  searchQuery: string,
  isTeamCreationModalVisible: boolean,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "teamList",
);

class TeamListView extends React.PureComponent<Props, State> {
  state = {
    isLoading: true,
    teams: [],
    searchQuery: "",
    isTeamCreationModalVisible: false,
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  async fetchData(): Promise<void> {
    const teams = await getEditableTeams();

    this.setState({
      isLoading: false,
      teams: teams,
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteTeam = (team: APITeamType) => {
    Modal.confirm({
      title: messages["team.delete"],
      onOk: async () => {
        this.setState({
          isLoading: true,
        });

        await deleteTeam(team.id);
        this.setState({
          isLoading: false,
          teams: this.state.teams.filter(t => t.id !== team.id),
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
      <div className="container">
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
              value={this.state.searchQuery}
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
                title="Action"
                key="actions"
                render={(__, script: APITeamType) => (
                  <a href="#" onClick={_.partial(this.deleteTeam, script)}>
                    <Icon type="delete" />Delete
                  </a>
                )}
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

export default withRouter(TeamListView);
