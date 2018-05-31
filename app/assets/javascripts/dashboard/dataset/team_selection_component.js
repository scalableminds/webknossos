// @flow
import * as React from "react";
import { Select } from "antd";
import { getEditableTeams } from "admin/admin_rest_api";
import type { APITeamType } from "admin/api_flow_types";

const { Option } = Select;

type Props = {
  value: Array<APITeamType>,
  onChange: (value: Array<APITeamType>) => void,
  mode?: ?string,
};

type State = {
  editableTeams: Array<APITeamType>,
  allowedTeams: Array<APITeamType>,
  uneditableTeams: Array<APITeamType>,
};

class TeamSelectionComponent extends React.PureComponent<Props, State> {
  state = {
    editableTeams: [],
    allowedTeams: this.props.value ? this.props.value : [],
    uneditableTeams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: Props) {
    this.setState({
      allowedTeams: newProps.value,
    });
    this.getUneditableTeams();
  }

  async fetchData() {
    const editableTeams = await getEditableTeams();
    this.setState({
      editableTeams,
    });
    this.getUneditableTeams();
  }

  getUneditableTeams = () => {
    const uneditableTeams = this.state.allowedTeams.filter(team =>
      this.state.editableTeams.every(editableTeam => editableTeam.id !== team.id),
    );
    this.setState({
      uneditableTeams,
    });
  };

  onSelectTeams = (selectedTeamIds: Array<string>) => {
    const allowedTeams = this.state.editableTeams.filter(team => selectedTeamIds.includes(team.id));
    this.state.uneditableTeams.forEach(uneditableTeam => {
      if (allowedTeams.every(allowedTeam => allowedTeam.id !== uneditableTeam.id))
        allowedTeams.push(uneditableTeam);
    });
    this.props.onChange(allowedTeams);
    this.setState({
      allowedTeams,
    });
  };

  render() {
    return (
      <Select
        showSearch
        mode={this.props.mode ? this.props.mode : "default"}
        style={{ width: "100%" }}
        placeholder="Select a Team"
        optionFilterProp="children"
        onChange={this.onSelectTeams}
        value={this.state.allowedTeams.map(t => t.name)}
        filterOption
      >
        {this.state.editableTeams.map(team => <Option key={team.id}>{team.name}</Option>)}
      </Select>
    );
  }
}

export default TeamSelectionComponent;
