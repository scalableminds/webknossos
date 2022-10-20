import { Select } from "antd";
import * as React from "react";
import _ from "lodash";
import type { APITeam } from "types/api_flow_types";
import { getEditableTeams, getTeams } from "admin/admin_rest_api";
const { Option } = Select;
type Props = {
  value?: APITeam | Array<APITeam>;
  onChange?: (value: APITeam | Array<APITeam>) => void;
  afterFetchedTeams?: (arg0: Array<APITeam>) => void;
  mode?: "default" | "multiple";
  allowNonEditableTeams?: boolean;
  disabled?: boolean;
};
type State = {
  possibleTeams: Array<APITeam>;
  selectedTeams: Array<APITeam>;
  isFetchingData: boolean;
};

class TeamSelectionComponent extends React.PureComponent<Props, State> {
  state: State = {
    possibleTeams: [],
    selectedTeams: this.props.value ? _.flatten([this.props.value]) : [],
    isFetchingData: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.value !== this.props.value) {
      this.setState({
        selectedTeams: this.props.value ? _.flatten([this.props.value]) : [],
      });
    }
  }

  async fetchData() {
    this.setState({
      isFetchingData: true,
    });
    try {
      const possibleTeams = this.props.allowNonEditableTeams
        ? await getTeams()
        : await getEditableTeams();
      this.setState({
        possibleTeams,
        isFetchingData: false,
      });

      if (this.props.afterFetchedTeams != null) {
        this.props.afterFetchedTeams(possibleTeams);
      }
    } catch (exception) {
      console.error("Could not load teams.");
    }
  }

  onSelectTeams = (selectedTeamIdsOrId: string | Array<string>) => {
    // we can't use this.props.mode because of flow
    const selectedTeamIds = Array.isArray(selectedTeamIdsOrId)
      ? selectedTeamIdsOrId
      : [selectedTeamIdsOrId];
    const allTeams = this.getAllTeams();

    const selectedTeams = _.compact(selectedTeamIds.map((id) => allTeams.find((t) => t.id === id)));

    if (this.props.onChange) {
      this.props.onChange(Array.isArray(selectedTeamIdsOrId) ? selectedTeams : selectedTeams[0]);
    }

    this.setState({
      selectedTeams,
    });
  };

  getAllTeams = (): Array<APITeam> =>
    _.unionBy(this.state.possibleTeams, this.state.selectedTeams, (t) => t.id);

  render() {
    return (
      <Select
        showSearch
        // @ts-expect-error ts-migrate(2322) FIXME: Type '"default" | "multiple"' is not assignable to... Remove this comment to see the full error message
        mode={this.props.mode ? this.props.mode : "default"}
        style={{
          width: "100%",
        }}
        placeholder={
          this.props.mode && this.props.mode === "multiple" ? "Select Teams" : "Select a Team"
        }
        optionFilterProp="children"
        onChange={this.onSelectTeams}
        value={this.state.selectedTeams.map((t) => t.id)}
        filterOption
        disabled={this.props.disabled ? this.props.disabled : false}
        loading={this.state.isFetchingData}
      >
        {this.getAllTeams().map((team) => (
          <Option
            disabled={this.state.possibleTeams.find((t) => t.id === team.id) == null}
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
