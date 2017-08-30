// @flow
import * as React from "react";
import { Modal, Button, Radio, Col, Row, Checkbox } from "antd";
import Request from "libs/request";
import update from "immutability-helper";
import type { APITeamType, APIUserType, APIRoleType } from "admin/api_flow_types";

const RadioButton = Radio.Button;
const RadioGroup = Radio.Group;

const ROLES = {
  admin: "admin",
  user: "user",
};

type TeamOptionalRoleType = {
  +team: string,
  +role: ?APIRoleType,
};

type TeamRoleModalPropType = {
  onChange: Function,
  onCancel: Function,
  visible: boolean,
  selectedUserIds: Array<string>,
  users: Array<APIUserType>,
};

type State = {
  teams: Array<APITeamType>,
  selectedTeams: Array<TeamOptionalRoleType>,
};

/**
 * All team selection in this modal is based on whether their is a role
 * associated with the respective team. In other words, 'selectedTeams' contains
 * all globally available teams, but only those with an attached role are
 * significant. See <APITeamRoleType>
 */

class TeamRoleModalView extends React.PureComponent<TeamRoleModalPropType, State> {
  state = {
    teams: [],
    selectedTeams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: TeamRoleModalPropType) {
    // If a single user is selected, pre-select his teams
    // otherwise unselect all teams
    const newSelectedTeams = this.state.selectedTeams.map(selectedTeam => {
      let newRole = null;

      if (newProps.selectedUserIds.length === 1) {
        const user = this.props.users.find(_user => _user.id === newProps.selectedUserIds[0]);
        if (user) {
          const userTeam = user.teams.find(_userTeam => selectedTeam.team === _userTeam.team);

          if (userTeam) {
            newRole = { name: userTeam.role.name };
          }
        }
      }

      return Object.assign({}, selectedTeam, { role: newRole });
    });

    this.setState({ selectedTeams: newSelectedTeams });
  }

  async fetchData() {
    const url = "/api/teams?amIAnAdmin=true";
    const teams = await Request.receiveJSON(url);

    const selectedTeams = teams.map(team => ({
      team: team.name,
      role: null,
    }));

    this.setState({
      teams,
      selectedTeams,
    });
  }

  setTeams = () => {
    const newTeams = this.state.selectedTeams.filter(team => team.role !== null);

    const newUserPromises = this.props.users.map(user => {
      if (this.props.selectedUserIds.includes(user.id)) {
        const newUser = Object.assign({}, user, { teams: newTeams });

        // server-side validation can reject a user's new teams
        const url = `/api/users/${user.id}`;
        return Request.sendJSONReceiveJSON(url, {
          data: newUser,
        }).then(() => Promise.resolve(newUser), () => Promise.reject(user));
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

  handleSelectTeamRole(teamName: string, roleName: $Keys<typeof ROLES>) {
    const newSelectedTeams = this.state.selectedTeams.map(selectedTeam => {
      if (selectedTeam.team === teamName) {
        return update(selectedTeam, { role: { $set: { name: roleName } } });
      }
      return selectedTeam;
    });

    this.setState({ selectedTeams: newSelectedTeams });
  }

  handleUnselectTeam(teamName: string) {
    const newSelectedTeams = this.state.selectedTeams.map(selectedTeam => {
      if (selectedTeam.team === teamName) {
        return update(selectedTeam, { role: { $set: null } });
      }
      return selectedTeam;
    });

    this.setState({ selectedTeams: newSelectedTeams });
  }

  getTeamComponent(team: TeamOptionalRoleType) {
    return (
      <Checkbox
        value={team.team}
        checked={team.role !== null}
        onChange={(event: SyntheticInputEvent<>) => {
          if (event.target.checked) {
            this.handleSelectTeamRole(team.team, ROLES.user);
          } else {
            this.handleUnselectTeam(team.team);
          }
        }}
      >
        {team.team}
      </Checkbox>
    );
  }

  getRoleComponent(team: TeamOptionalRoleType) {
    return (
      <RadioGroup
        size="small"
        value={team.role == null ? null : team.role.name}
        style={{ width: "100%" }}
        disabled={team.role == null}
        onChange={({ target: { value } }) => this.handleSelectTeamRole(team.team, value)}
      >
        <RadioButton value={ROLES.admin}>Admin</RadioButton>
        <RadioButton value={ROLES.user}>User</RadioButton>
      </RadioGroup>
    );
  }

  render() {
    const teamsRoleComponents = this.state.selectedTeams.map(team => (
      <Row key={team.team}>
        <Col span={12}>{this.getTeamComponent(team)}</Col>
        <Col span={12}>{this.getRoleComponent(team)}</Col>
      </Row>
    ));

    return (
      <Modal
        title="Assign teams"
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        footer={
          <div>
            <Button onClick={this.setTeams} type="primary">
              Set Teams
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <Row>
          <Col span={12}>
            <h4>Teams</h4>
          </Col>
          <Col span={12}>
            <h4>Role</h4>
          </Col>
        </Row>
        {teamsRoleComponents}
      </Modal>
    );
  }
}

export default TeamRoleModalView;
