// @flow

import _ from "lodash";
import React from "react";
import { Spin, Modal, Button } from "antd";
import Request from "libs/request";
import type { APIUserType } from "admin/api_flow_types";

class TransferTaskModal extends React.PureComponent {
  props: {
    onChange: Function,
    // Somehow, eslint doesn't recognize that annotationId is used in
    // the async functions
    // eslint-disable-next-line react/no-unused-prop-types
    annotationId: ?string,
    onCancel: Function,
    visible: boolean,
    userID: ?string,
  };

  state: {
    isLoading: boolean,
    users: Array<APIUserType>,
    currentUserIdValue: string,
  } = {
    isLoading: false,
    users: [],
    currentUserIdValue: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({ isLoading: true });
    const users = await Request.receiveJSON("/api/users");
    this.setState({ isLoading: false });
    const sortedUsers = _.sortBy(users, "lastName");

    this.setState({
      users: sortedUsers,
    });
  }

  async transfer() {
    if (!this.props.annotationId) {
      throw new Error("No annotation id provided");
    }
    const url = `/annotations/Task/${this.props.annotationId}/transfer`;
    this.setState({ isLoading: true });
    await Request.sendJSONReceiveJSON(url, {
      data: {
        userId: this.state.currentUserIdValue,
      },
    });
    this.setState({ isLoading: false });
    this.props.onChange();
  }

  handleSelectChange = (event: SyntheticInputEvent) => {
    this.setState({ currentUserIdValue: event.target.value });
  };

  renderFormContent() {
    return (
      <div>
        <label htmlFor="transfer-user-select">
          {"New User's Name"}
        </label>

        <select
          id="transfer-user-select"
          className="form-control"
          value={this.state.currentUserIdValue}
          onChange={this.handleSelectChange}
        >
          <option key="empty" value="" />
          {this.state.users.filter(u => u.id !== this.props.userID).map(user =>
            <option key={user.id} value={user.id}>
              {user.lastName}, {user.firstName} ({user.email})
            </option>,
          )}
        </select>
      </div>
    );
  }

  render() {
    if (!this.props.visible) {
      return null;
    }

    return (
      <Modal
        title="Transfer a Task"
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        footer={
          <div>
            <Button
              type="primary"
              onClick={() => this.transfer()}
              disabled={this.state.currentUserIdValue === ""}
            >
              Transfer
            </Button>
            <Button onClick={() => this.props.onCancel()}>Close</Button>
          </div>
        }
      >
        <div className="control-group">
          <div className="form-group">
            {this.state.isLoading
              ? <div className="text-center">
                  <Spin size="large" />
                </div>
              : this.renderFormContent()}
          </div>
        </div>
      </Modal>
    );
  }
}

export default TransferTaskModal;
