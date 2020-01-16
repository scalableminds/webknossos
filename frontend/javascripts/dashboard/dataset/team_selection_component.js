// @flow
import { Select } from "antd";
import * as React from "react";
import _ from "lodash";

import type { APITeam } from "admin/api_flow_types";
import { getEditableTeams, getTeams } from "admin/admin_rest_api";

const { Option } = Select;

type Props = {
  value?: APITeam | Array<APITeam>,
  onChange?: (value: APITeam | Array<APITeam>) => void,
  mode?: "default" | "multiple",
  allowNonEditableTeams?: boolean,
  disabled?: boolean,
};

type State = {
  possibleTeams: Array<APITeam>,
  selectedTeams: Array<APITeam>,
};

class TeamSelectionComponent extends React.PureComponent<Props, State> {
  state = {
    possibleTeams: [],
    selectedTeams: this.props.value ? _.flatten([this.props.value]) : [],
  };

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: Props) {
    if (newProps.value) {
      this.setState({
        selectedTeams: _.flatten([newProps.value]),
      });
    }
  }

  async fetchData() {
    const possibleTeams = this.props.allowNonEditableTeams
      ? await getTeams()
      : await getEditableTeams();
    this.setState({
      possibleTeams,
    });
  }

  onSelectTeams = (selectedTeamIdsOrId: string | Array<string>) => {
    // we can't use this.props.mode because of flow
    const selectedTeamIds = Array.isArray(selectedTeamIdsOrId)
      ? selectedTeamIdsOrId
      : [selectedTeamIdsOrId];
    const allTeams = this.getAllTeams();
    const selectedTeams = _.compact(selectedTeamIds.map(id => allTeams.find(t => t.id === id)));
    if (this.props.onChange) {
      this.props.onChange(Array.isArray(selectedTeamIdsOrId) ? selectedTeams : selectedTeams[0]);
    }
    this.setState({
      selectedTeams,
    });
  };

  getAllTeams = (): Array<APITeam> =>
    _.unionBy(this.state.possibleTeams, this.state.selectedTeams, t => t.id);

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
        value={this.state.selectedTeams.map(t => t.id)}
        filterOption
        disabled={this.props.disabled ? this.props.disabled : false}
      >
        {this.getAllTeams().map(team => (
          <Option
            disabled={this.state.possibleTeams.find(t => t.id === team.id) == null}
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
