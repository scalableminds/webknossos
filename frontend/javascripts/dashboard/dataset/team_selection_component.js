// @flow
import { Select } from "antd";
import * as React from "react";
import _ from "lodash";

import type { APITeam } from "admin/api_flow_types";
import { getEditableTeams } from "admin/admin_rest_api";

const { Option } = Select;

type Props = {
  value?: APITeam | Array<APITeam>,
  onChange?: (value: APITeam | Array<APITeam>) => void,
  mode?: "default" | "multiple",
};

type State = {
  editableTeams: Array<APITeam>,
  allowedTeams: Array<APITeam>,
};

class TeamSelectionComponent extends React.PureComponent<Props, State> {
  state = {
    editableTeams: [],
    allowedTeams: this.props.value ? _.flatten([this.props.value]) : [],
  };

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: Props) {
    if (newProps.value) {
      this.setState({
        allowedTeams: _.flatten([newProps.value]),
      });
    }
  }

  async fetchData() {
    const editableTeams = await getEditableTeams();
    this.setState({
      editableTeams,
    });
  }

  onSelectTeams = (selectedTeamIdsOrId: string | Array<string>) => {
    // we can't use this.props.mode because of flow
    const selectedTeamIds = Array.isArray(selectedTeamIdsOrId)
      ? selectedTeamIdsOrId
      : [selectedTeamIdsOrId];
    const allTeams = this.getAllTeams();
    const allowedTeams = _.compact(selectedTeamIds.map(id => allTeams.find(t => t.id === id)));
    if (this.props.onChange) {
      this.props.onChange(Array.isArray(selectedTeamIdsOrId) ? allowedTeams : allowedTeams[0]);
    }
    this.setState({
      allowedTeams,
    });
  };

  getAllTeams = (): Array<APITeam> =>
    _.unionBy(this.state.editableTeams, this.state.allowedTeams, t => t.id);

  render() {
    return (
      <Select
        showSearch
        mode={this.props.mode ? this.props.mode : "default"}
        style={{ width: "100%" }}
        placeholder={
          this.props.mode && this.props.mode === "multiple" ? "Select Teams" : "Select a Team"
        }
        optionFilterProp="children"
        onChange={this.onSelectTeams}
        value={this.state.allowedTeams.map(t => t.id)}
        filterOption
      >
        {this.getAllTeams().map(team => (
          <Option
            disabled={this.state.editableTeams.find(t => t.id === team.id) == null}
            key={team.id}
          >
            {team.name}
          </Option>
        ))}
      </Select>
    );
  }
}

export default TeamSelectionComponent;
