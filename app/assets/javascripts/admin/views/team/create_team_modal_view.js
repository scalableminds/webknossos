// @flow
import * as React from "react";
import { Modal, Input, Button } from "antd";
import { getRootTeams, createTeam } from "admin/admin_rest_api";
import type { APITeamType } from "admin/api_flow_types";

type Props = {
  onOk: Function,
  onCancel: Function,
  isVisible: boolean,
};

type State = {
  newTeamName: string,
};

class CreateTeamModalView extends React.PureComponent<Props, State> {
  state = {
    newTeamName: "",
  };

  onOk = async () => {
    if (this.state.newTeamName !== "") {
      const newTeam = {
        name: this.state.newTeamName,
        roles: [{ name: "admin" }, { name: "user" }],
      };

      const team = await createTeam(newTeam);
      this.setState({
        newTeamName: "",
      });

      this.props.onOk(team);
    }
  };

  isInputValid(): boolean {
    return this.state.newTeamName !== "";
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
        <Input
          value={this.state.newTeamName}
          onChange={(event: SyntheticInputEvent<*>) =>
            this.setState({ newTeamName: event.target.value })
          }
          icon="tag-o"
          placeholder="Team Name"
          autoFocus
        />
      </Modal>
    );
  }
}
export default CreateTeamModalView;
