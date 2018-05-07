// @flow
import * as React from "react";
import { Select } from "antd";
import { getEditableTeams } from "admin/admin_rest_api";
import type { APITeamType } from "admin/api_flow_types";

const { Option } = Select;

type Props = {
  value: Array<APITeamType>,
  onChange: (value: Array<APITeamType>) => void,
  mode?: ?string
};

type State = {
  teams: Array<APITeamType>,
  allowedTeams: Array<APITeamType>
};

class TeamSelectionComponent extends React.PureComponent<Props, State> {
  state = {
    teams: [],
    allowedTeams: this.props.value ? this.props.value : []
  };

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: Props) {
    this.setState({
      allowedTeams: newProps.value,
    });
  }

  async fetchData() {
    const teams = await getEditableTeams();
    this.setState({
      teams,
    });
  }

  onSelectTeams = (selectedTeamIds: Array<string>) => {
    const allowedTeams = this.state.teams.filter(team => selectedTeamIds.includes(team.id));
    this.props.onChange(allowedTeams);
    this.setState({
      allowedTeams,
    })
  };

  render() {
    return (
      <Select
        showSearch
        mode = {this.props.mode ? this.props.mode : "default"}
        style={{ width: "100%" }}
        placeholder="Select a Team"
        optionFilterProp="children"
        onChange={this.onSelectTeams}
        value={this.state.allowedTeams.map(t => t.id)}
        filterOption
      >
        {this.state.teams.map(team => <Option key={team.id}>{team.name}</Option>)}
      </Select>
    );
  }
}

export default TeamSelectionComponent;
