// @flow
import _ from "lodash";
import * as React from "react";
import { Modal, Spin, Select } from "antd";
import Request from "libs/request";
import type { APITeamType } from "admin/api_flow_types";
import type { DatasetType } from "dashboard/views/dataset_view";

const { Option } = Select;

type Props = {
  isVisible: boolean,
  onOk: Function,
  onCancel: Function,
  dataset: DatasetType,
};

type State = {
  teams: Array<APITeamType>,
  isLoading: boolean,
  selectedTeams: Array<string>,
};

class TeamAssignmentModal extends React.PureComponent<Props, State> {
  state = {
    teams: [],
    isLoading: true,
    selectedTeams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  componentWillReceiveProps(newProps: Props) {
    this.setState({
      selectedTeams: newProps.dataset ? newProps.dataset.allowedTeams : [],
    });
  }

  async fetchData() {
    const url = "/api/teams";
    const teams = await Request.receiveJSON(url);
    this.setState({
      isLoading: false,
      teams,
    });
  }

  selectTeams = (selectedTeams: Array<string>) => {
    // make sure the owningTeam is always selected
    const allowedTeams = _.uniq([this.props.dataset.owningTeam, ...selectedTeams]);
    this.setState({
      selectedTeams: allowedTeams,
    });
  };

  onOk = () => {
    const updatedDataset = Object.assign({}, this.props.dataset, {
      allowedTeams: this.state.selectedTeams,
    });

    const url = `/api/datasets/${this.props.dataset.name}/teams`;
    Request.sendJSONReceiveJSON(url, {
      data: updatedDataset.allowedTeams,
    }).then(() => {
      this.props.onOk(updatedDataset);
    });
  };

  render() {
    return (
      <Modal
        visible={this.props.isVisible}
        title="Team Assignment"
        onOk={this.onOk}
        onCancel={this.props.onCancel}
      >
        <Spin spinning={this.state.isLoading} size="large">
          <Select
            showSearch
            mode="multiple"
            style={{ width: "100%" }}
            placeholder="Select a Team"
            optionFilterProp="children"
            onChange={this.selectTeams}
            value={this.state.selectedTeams}
            filterOption={(input, option) =>
              option.props.children.toLowerCase().indexOf(input.toLowerCase()) >= 0}
          >
            {this.state.teams.map(team =>
              <Option key={team.name} value={team.name}>
                {team.name}
              </Option>,
            )}
          </Select>
        </Spin>
      </Modal>
    );
  }
}

export default TeamAssignmentModal;
