// @flow
import _ from "lodash";
import * as React from "react";
import { Select } from "antd";
import { updateDatasetTeams, getEditableTeams } from "admin/admin_rest_api";
import type { APITeamType } from "admin/api_flow_types";
import type { DatasetType } from "dashboard/dataset_view";

const { Option } = Select;

type Props = {
  dataset: DatasetType,
  allowedTeams: Array<APITeamType>,
  onTeamsChange: Function,
};

type State = {
  teams: Array<APITeamType>,
};

class TeamAssignment extends React.PureComponent<Props, State> {
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
    const uniqueIds = _.uniq(selectedTeamIds);

    const allowedTeams = this.state.teams.filter(team => uniqueIds.includes(team.id));
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
            filterOption={(input, option) =>
              option.props.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
            }>
            {this.state.teams.map(team => (
              <Option key={team.name} value={team.id}>
                {team.name}
              </Option>
            ))}
          </Select>
    );
  }
}

export default TeamAssignment;
