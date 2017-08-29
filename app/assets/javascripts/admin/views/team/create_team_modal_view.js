import * as React from "react";
import { Modal, Input, Select, Spin, Button } from "antd";
import Request from "libs/request";
import type { APITeamType } from "admin/api_flow_types";

const { Option } = Select;

type Props = {
  onOk: Function,
  onCancel: Function,
  isVisible: boolean,
};

type State = {
  newTeamName: string,
  parentTeam: ?string,
  teams: Array<APITeamType>,
  isLoading: boolean,
};

class CreateTeamModalView extends React.PureComponent<Props, State> {
  state = {
    newTeamName: "",
    parentTeam: undefined,
    teams: [],
    isLoading: true,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const url = "/api/teams?isRoot=true";
    const teams = await Request.receiveJSON(url);

    this.setState({
      isLoading: false,
      teams,
    });
  }

  onOk = () => {
    if (this.isInputValid()) {
      const newTeam = {
        name: this.state.newTeamName,
        parent: this.state.parentTeam,
        roles: [{ name: "admin" }, { name: "user" }],
        isEditable: "true",
      };

      const url = "/api/teams";
      Request.sendJSONReceiveJSON(url, { data: newTeam }).then(team => {
        this.setState({
          newTeamName: "",
          parentTeam: undefined,
        });

        this.props.onOk(team);
      });
    }
  };

  isInputValid(): boolean {
    return this.state.newTeamName !== "" && this.state.parentTeam !== undefined;
  }

  render() {
    return (
      <Modal
        title="Add a New Team"
        visible={this.props.isVisible}
        footer={
          <div>
            <Button onClick={this.props.onCancel}>Cancel</Button>
            <Button type="primary" onClick={this.onOk} disabled={!this.isInputValid()}>
              Ok
            </Button>
          </div>
        }
      >
        <Spin spinning={this.state.isLoading} size="large">
          <Input
            value={this.state.newTeamName}
            onChange={(event: SyntheticInputEvent) =>
              this.setState({ newTeamName: event.target.value })}
            icon="tag-o"
            placeholder="Team Name"
            autoFocus
          />
          <Select
            showSearch
            style={{ width: "100%", marginTop: 10 }}
            placeholder="Select a parent team"
            optionFilterProp="children"
            onChange={(value: string) => this.setState({ parentTeam: value })}
            value={this.state.parentTeam}
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
export default CreateTeamModalView;
