// @flow

import _ from "lodash";
import React from "react";
import { Modal, Button, Radio, Col, Row, Checkbox } from "antd";
import Request from "libs/request";
import type { APITeamType, APIUserType, APITeamRoleType } from "admin/api_flow_types";

const RadioButton = Radio.Button;
const RadioGroup = Radio.Group;

const ROLES = {
  admin: "admin",
  user: "user",
}

type TeamRoleModalPropType = {
  onChange: Function,
  onCancel: Function,
  visible: boolean,
  selectedUserIds: Array<string>,
  users: Array<APIUserType>,
}

class TeamRoleModalView extends React.PureComponent {

  props: TeamRoleModalPropType;

  state: {
    teams: Array<APITeamType>,
    selectedTeams: Array<APITeamRoleType>
  } = {
    teams: [],
    selectedTeams: [],
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: TeamRoleModalPropType) {
    // If a single user is selected, pre-select his teams
    const newSelectedTeams = this.state.selectedTeams.map(selectedTeam => {
      let role;
      if (newProps.selectedUserIds.length === 1) {
        const user = this.props.users.find((_user) => _user.id === newProps.selectedUserIds[0]);
        const userTeam = user.teams.find(_userTeam => selectedTeam.team === _userTeam.team);

        if (userTeam) {
          role = { name: userTeam.role.name };
        }
      } else {
      // otherwise unselect all teams
        role = null;
      }

      return Object.assign({}, selectedTeam, { role });
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

    const newUsers = this.props.users.map((user) => {
      if (this.props.selectedUserIds.includes(user.id)) {
        // user.teams = [...newTeams]; // copy the array
        return Object.assign({}, user, {teams: [...newTeams]});
        // const url = `/api/users/${user.id}`;
        // Request.sendJSONReceiveJSON(url, {
        //   data: user
        // });
      }
      return user;
    })
    this.props.onChange(newUsers);
  }

  handleSelectTeamRole(teamName:string, roleName:$Keys<typeof ROLES>) {
    const newSelectedTeams = this.state.selectedTeams.map((selectedTeam) => {
      if (selectedTeam.team === teamName) {
        selectedTeam.role = { name: roleName };
      }
      return selectedTeam
    });

    this.setState({ selectedTeams: newSelectedTeams });
  }

  handleUnselectTeam(teamName:string) {
     const newSelectedTeams = this.state.selectedTeams.map((selectedTeam) => {
      if (selectedTeam.team === teamName) {
        selectedTeam.role = null;
      }
      return selectedTeam
    });

    this.setState({ selectedTeams: newSelectedTeams });
  }

  getTeamComponent(team: APITeamRoleType) {
    return <Checkbox
      value={team.team}
      checked={team.role !== null}
      onChange={(event: SyntheticInputEvent) => {
        if (event.target.checked) {
          this.handleSelectTeamRole(team.team, ROLES.user);
        } else {
          this.handleUnselectTeam(team.team);
        }
      }}
    >
      {team.team}
    </Checkbox>
  }

  getRoleComponent(team: APITeamRoleType) {
    return <RadioGroup
        size="small"
        value={team.role === null? null: team.role.name}
        style={{ width: "100%" }}
        disabled={team.role === null}
        onChange={(event: SyntheticInputEvent) => this.handleSelectTeamRole(team.team, event.target.value) }
      >
        <RadioButton value={ROLES.admin}>
          Admin
        </RadioButton>
        <RadioButton value={ROLES.user}>
          User
        </RadioButton>
      </RadioGroup>
  }

  render() {
    const teamsRoleComponents = this.state.selectedTeams.map(team =>
      <Row key={team.team}>
        <Col span={12}>
          {this.getTeamComponent(team)}
        </Col>
        <Col span={12}>
          {this.getRoleComponent(team)}
        </Col>
      </Row>
    );

    return (
      <Modal
        title="Assign teams"
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        footer={
          <div>
            <Button onClick={this.setTeams} type="primary">Set Teams</Button>
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
    )
  }
}

export default TeamRoleModalView;
