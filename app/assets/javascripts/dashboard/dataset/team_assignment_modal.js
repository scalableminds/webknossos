// @flow
import _ from "lodash";
import * as React from "react";
import { Modal, Spin, Select } from "antd";
import { updateDatasetTeams, getEditableTeams } from "admin/admin_rest_api";
import type { APITeamType } from "admin/api_flow_types";
import type { DatasetType } from "dashboard/dataset_view";

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
  selectedTeams: Array<APITeamType>,
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

  async fetchData() {
    const teams = await getEditableTeams();
    this.setState({
      isLoading: false,
      selectedTeams: this.props.dataset ? this.props.dataset.allowedTeams : [],
      teams,
    });
  }

  selectTeams = (selectedTeamIds: Array<string>) => {
    const uniqueIds = _.uniq([...selectedTeamIds]);
    const allowedTeams = this.state.teams.filter(team => uniqueIds.includes(team.id));
    this.setState({
      selectedTeams: allowedTeams,
    });
  };

  onOk = () => {
    const updatedDataset = Object.assign({}, this.props.dataset, {
      allowedTeams: this.state.selectedTeams,
    });

    const teamIds = updatedDataset.allowedTeams.map(t => t.id);
    updateDatasetTeams(updatedDataset.name, teamIds).then(() => {
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
            value={this.state.selectedTeams.map(t => t.id)}
            filterOption={(input, option) =>
              option.props.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
            }
          >
            {this.state.teams.map(team => (
              <Option key={team.name} value={team.id}>
                {team.name}
              </Option>
            ))}
          </Select>
        </Spin>
      </Modal>
    );
  }
}

export default TeamAssignmentModal;
