// @flow
import * as React from "react";
import { Select } from "antd";
import { getEditableTeams } from "admin/admin_rest_api";
import type { APITeamType } from "admin/api_flow_types";

const { Option } = Select;

type Props = {
  allowedTeams: Array<APITeamType>,
  onTeamsChange: Function,
};

type State = {
  teams: Array<APITeamType>,
};

class TeamSelectionComponent extends React.PureComponent<Props, State> {
  state = {
    teams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const teams = await getEditableTeams();
    this.setState({
      teams,
    });
  }

  onSelectTeams = (selectedTeamIds: Array<string>) => {
    const allowedTeams = this.state.teams.filter(team => selectedTeamIds.includes(team.id));
    this.props.onTeamsChange(allowedTeams);
  };

  render() {
    return (
      <Select
        showSearch
        mode="multiple"
        style={{ width: "100%" }}
        placeholder="Select a Team"
        optionFilterProp="children"
        onChange={this.onSelectTeams}
        value={this.props.allowedTeams.map(t => t.id)}
        filterOption
      >
        {this.state.teams.map(team => <Option key={team.id}>{team.name}</Option>)}
      </Select>
    );
  }
}

export default TeamSelectionComponent;
