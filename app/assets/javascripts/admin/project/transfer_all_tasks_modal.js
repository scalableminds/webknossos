// @flow

import _ from "lodash";
import * as React from "react";
import { Spin, Modal, Button, Select, Table } from "antd";
import {
  getUsers,
  getUsersWithActiveTasks,
  transferActiveTasksOfProject,
} from "admin/admin_rest_api";
import type { APIUserType, APIProjectType, APIActiveUserType } from "admin/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";

const { Option } = Select;

type Props = {
  project: ?APIProjectType,
  onCancel: Function,
  visible: boolean,
};

type TableEntryType = {
  key: string,
} & APIActiveUserType;

type State = {
  isLoading: boolean,
  users: Array<APIUserType>,
  selectedUser: ?APIUserType,
  usersWithActiveTasks: Array<APIActiveUserType>,
};

class TransferAllTasksModal extends React.PureComponent<Props, State> {
  state = {
    isLoading: false,
    users: [],
    selectedUser: null,
    usersWithActiveTasks: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({ isLoading: true });
    const users = await getUsers();
    const activeUsers = users.filter(u => u.isActive);
    let usersWithActiveTasks: Array<APIActiveUserType> = [];
    if (this.props.project) {
      usersWithActiveTasks = await getUsersWithActiveTasks(this.props.project.name);
    }
    this.setState({ isLoading: false, usersWithActiveTasks });
    const sortedUsers = _.sortBy(activeUsers, "lastName");
    this.setState({
      users: sortedUsers,
    });
  }

  async transferAllActiveTasks() {
    if (this.state.selectedUser && this.props.project) {
      try {
        await transferActiveTasksOfProject(this.props.project.name, this.state.selectedUser.id);
        if (this.state.selectedUser) {
          Toast.success(
            `${messages["project.successful_active_tasks_transfer"]} ${
              this.state.selectedUser.lastName
            }, ${this.state.selectedUser.firstName}`,
          );
        }
      } catch (e) {
        Toast.error(messages["project.unsuccessful_active_tasks_transfer"]);
      }
      this.props.onCancel();
    }
  }

  renderTableContent() {
    const activeUsersWithKey: Array<TableEntryType> = this.state.usersWithActiveTasks.map(
      activeUser => {
        const userWithKey = {
          email: activeUser.email,
          activeTasks: activeUser.activeTasks,
          key: activeUser.email,
        };
        return userWithKey;
      },
    );
    const columns = [
      {
        title: "user's email",
        dataIndex: "email",
        key: "email",
      },
      {
        title: "number of active tasks",
        dataIndex: "activeTasks",
        key: "activeTasks",
      },
    ];
    return (
      <Table
        columns={columns}
        dataSource={activeUsersWithKey}
        rowKey="email"
        pagination={false}
        size="small"
      />
    );
  }

  handleSelectChange = (userId: string) => {
    const selectedUser = this.state.users.find(user => user.id === userId);
    this.setState({ selectedUser });
  };

  renderFormContent() {
    return (
      <Select
        showSearch
        placeholder="Select a New User"
        value={this.state.selectedUser ? this.state.selectedUser.id : ""}
        onChange={this.handleSelectChange}
        optionFilterProp="children"
        style={{ width: "100%" }}
        filterOption={(input, option) =>
          option.props.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
        }
      >
        {this.state.users.map(user => (
          <Option key={user.id} value={user.id}>
            {`${user.lastName}, ${user.firstName} ${user.email}`}
          </Option>
        ))}
      </Select>
    );
  }

  // TODO own user does not show up !!
  // use newly available api requests
  render() {
    if (!this.props.visible) {
      return null;
    }
    const project = this.props.project;
    if (!project) {
      Toast.error(messages["project.none_selected"]);
      return null;
    } else {
      Toast.close(messages["project.none_selected"]);
      const title = `All users with open tasks of ${project.name}`;
      return (
        <Modal
          title={title}
          visible={this.props.visible}
          onCancel={this.props.onCancel}
          pagination="false"
          footer={
            <div>
              <Button
                type="primary"
                disabled={!this.state.selectedUser}
                onClick={() => this.transferAllActiveTasks()}
              >
                Transfer all tasks
              </Button>
              <Button onClick={() => this.props.onCancel()}>Close</Button>
            </div>
          }
        >
          <div>
            {this.renderTableContent()}
            <br />
            <br />
          </div>
          Select a user to transfer the tasks to:
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
}

export default TransferAllTasksModal;
