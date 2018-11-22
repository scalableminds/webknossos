// @flow
import { Modal, Button, Radio, Col, Row, Checkbox } from "antd";
import * as React from "react";
import _ from "lodash";
import update from "immutability-helper";

import type { APIUser, APITeam, APITeamMembership } from "admin/api_flow_types";
import { updateUser, getEditableTeams } from "admin/admin_rest_api";
import messages from "messages";

const RadioButton = Radio.Button;
const RadioGroup = Radio.Group;

const ROLES = {
  teammanager: "teammanager",
  user: "user",
};

type TeamRoleModalProp = {
  onChange: Function,
  onCancel: Function,
  visible: boolean,
  selectedUserIds: Array<string>,
  users: Array<APIUser>,
};

type State = {
  teams: Array<APITeam>,
  selectedTeams: { [key: string]: APITeamMembership },
};

class TeamRoleModalView extends React.PureComponent<TeamRoleModalProp, State> {
  state = {
    selectedTeams: {},
    teams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: TeamRoleModalProp) {
    // If a single user is selected, pre-select his teams
    if (newProps.selectedUserIds.length === 1) {
      const user = this.props.users.find(_user => _user.id === newProps.selectedUserIds[0]);
      if (user) {
        const newSelectedTeams = _.keyBy(user.teams, "name");
        this.setState({ selectedTeams: newSelectedTeams });
      }
    }
  }

  async fetchData() {
    const teams = await getEditableTeams();

    this.setState({
      teams,
    });
  }

  setTeams = () => {
    const newUserPromises = this.props.users.map(user => {
      if (this.props.selectedUserIds.includes(user.id)) {
        const newTeams = ((Object.values(this.state.selectedTeams): any): Array<APITeamMembership>);
        const newUser = Object.assign({}, user, { teams: newTeams });

        // server-side validation can reject a user's new teams
        return updateUser(newUser).then(
          serverUser => Promise.resolve(serverUser),
          () => Promise.reject(user),
        );
      }
      return Promise.resolve(user);
    });

    Promise.all(newUserPromises).then(
      newUsers => {
        this.props.onChange(newUsers);
      },
      () => {
        // do nothing and keep modal open
      },
    );
  };

  handleSelectTeamRole(teamName: string, isTeamManager: boolean) {
    const team = this.state.teams.find(t => t.name === teamName);

    if (team) {
      const selectedTeam = { id: team.id, name: teamName, isTeamManager };
      this.setState(prevState => ({
        selectedTeams: update(prevState.selectedTeams, {
          [teamName]: { $set: selectedTeam },
        }),
      }));
    }
  }

  handleUnselectTeam(teamName: string) {
    this.setState(prevState => ({
      selectedTeams: update(prevState.selectedTeams, {
        $unset: [teamName],
      }),
    }));
  }

  getTeamComponent(team: APITeam) {
    return (
      <Checkbox
        value={team.name}
        checked={_.has(this.state.selectedTeams, team.name)}
        onChange={(event: SyntheticInputEvent<>) => {
          if (event.target.checked) {
            this.handleSelectTeamRole(team.name, false);
          } else {
            this.handleUnselectTeam(team.name);
          }
        }}
      >
        {team.name}
      </Checkbox>
    );
  }

  getRoleComponent(team: APITeam) {
    const selectedTeam = this.state.selectedTeams[team.name];
    let selectedValue = null;
    if (selectedTeam) {
      selectedValue = selectedTeam.isTeamManager ? ROLES.teammanager : ROLES.user;
    }

    return (
      <RadioGroup
        size="small"
        style={{ width: "100%" }}
        value={selectedValue}
        disabled={!_.has(this.state.selectedTeams, team.name)}
        onChange={({ target: { value } }) =>
          this.handleSelectTeamRole(team.name, value === ROLES.teammanager)
        }
      >
        <RadioButton value={ROLES.teammanager}>Team Manager</RadioButton>
        <RadioButton value={ROLES.user}>User</RadioButton>
      </RadioGroup>
    );
  }

  render() {
    const isAdmin = this.props.selectedUserIds.some(userId =>
      this.props.users.some(u => u.id === userId && u.isAdmin),
    );
    const teamsRoleComponents = this.state.teams.map(team => (
      <Row key={team.id}>
        <Col span={12}>{this.getTeamComponent(team)}</Col>
        <Col span={12}>{this.getRoleComponent(team)}</Col>
      </Row>
    ));

    return (
      <Modal
        title="Assign Teams"
        maskClosable={false}
        closable={false}
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        footer={
          <div>
            {isAdmin ? null : (
              <Button onClick={this.setTeams} type="primary">
                Set Teams
              </Button>
            )}
            <Button onClick={this.props.onCancel}>Cancel</Button>
          </div>
        }
      >
        {isAdmin ? (
          <p>{messages["users.is_admin"]}</p>
        ) : (
          <div>
            <Row>
              <Col span={12}>
                <h4>Teams</h4>
              </Col>
              <Col span={12}>
                <h4>Role</h4>
              </Col>
            </Row>
            {teamsRoleComponents}
          </div>
        )}
      </Modal>
    );
  }
}

export default TeamRoleModalView;
