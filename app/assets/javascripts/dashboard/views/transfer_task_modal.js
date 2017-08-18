// @flow

import _ from "lodash";
import * as React from "react";
import { Spin, Modal, Button, Select } from "antd";
import Request from "libs/request";
import type { APIUserType } from "admin/api_flow_types";

const { Option } = Select;

class TransferTaskModal extends React.PureComponent<{
  onChange: Function,
  // Somehow, eslint doesn't recognize that annotationId is used in
  // the async functions
  // eslint-disable-next-line react/no-unused-prop-types
  annotationId: ?string,
  onCancel: Function,
  visible: boolean,
  userID: ?string,
}, {
  isLoading: boolean,
  users: Array<APIUserType>,
  currentUserIdValue: string,
}> {
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

  handleSelectChange = (userId: string) => {
    this.setState({ currentUserIdValue: userId });
  };

  renderFormContent() {
    return (
      <Select
        showSearch
        placeholder="Select a New User"
        value={this.state.currentUserIdValue}
        onChange={this.handleSelectChange}
        optionFilterProp="children"
        style={{ width: "100%" }}
        filterOption={(input, option) =>
          option.props.children.toLowerCase().indexOf(input.toLowerCase()) >= 0}
      >
        {this.state.users.filter(u => u.id !== this.props.userID).map(user =>
          <Option key={user.id} value={user.id}>
            {`${user.lastName}, ${user.firstName} ${user.email}`}
          </Option>,
        )}
      </Select>
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
