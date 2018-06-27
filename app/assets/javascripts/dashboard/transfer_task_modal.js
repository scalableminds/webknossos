// @flow

import _ from "lodash";
import * as React from "react";
import { Spin, Modal, Button, Select } from "antd";
import { getUsers, transferTask } from "admin/admin_rest_api";
import type { APIUserType, APIAnnotationType } from "admin/api_flow_types";
import { handleGenericError } from "libs/error_handling";

const { Option } = Select;

type Props = {
  onChange: (updatedAnnotation: APIAnnotationType) => void,
  annotationId: ?string,
  onCancel: Function,
  visible: boolean,
  userId: ?string,
};

type State = {
  isLoading: boolean,
  users: Array<APIUserType>,
  currentUserIdValue: string,
};

class TransferTaskModal extends React.PureComponent<Props, State> {
  state = {
    isLoading: false,
    users: [],
    currentUserIdValue: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    try {
      this.setState({ isLoading: true });
      const users = await getUsers();
      const activeUsers = users.filter(u => u.isActive);
      const sortedUsers = _.sortBy(activeUsers, "lastName");

      this.setState({
        users: sortedUsers,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  async transfer() {
    const annotationId = this.props.annotationId;
    if (!annotationId) {
      throw new Error("No annotation id provided");
    }
    try {
      this.setState({ isLoading: true });
      const updatedAnnotation = await transferTask(annotationId, this.state.currentUserIdValue);
      this.props.onChange(updatedAnnotation);
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
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
          option.props.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
        }
      >
        {this.state.users.filter(u => u.id !== this.props.userId).map(user => (
          <Option key={user.id} value={user.id}>
            {`${user.lastName}, ${user.firstName} ${user.email}`}
          </Option>
        ))}
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
            {this.state.isLoading ? (
              <div className="text-center">
                <Spin size="large" />
              </div>
            ) : (
              this.renderFormContent()
            )}
          </div>
        </div>
      </Modal>
    );
  }
}

export default TransferTaskModal;
