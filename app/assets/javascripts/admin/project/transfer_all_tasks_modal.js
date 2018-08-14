// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Table, Spin } from "antd";
import {
  getUsers,
  getUsersWithActiveTasks,
  transferActiveTasksOfProject,
} from "admin/admin_rest_api";
import type { APIUserType, APIProjectType, APIActiveUserType } from "admin/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";
import { handleGenericError } from "libs/error_handling";
import UserSelectionComponent from "admin/user/user_selection_component";

type Props = {
  project: ?APIProjectType,
  onCancel: () => void,
  onComplete: () => void,
};

type State = {
  users: Array<APIUserType>,
  selectedUser: ?APIUserType,
  usersWithActiveTasks: Array<APIActiveUserType>,
  isLoading: boolean,
};

class TransferAllTasksModal extends React.PureComponent<Props, State> {
  state = {
    users: [],
    selectedUser: null,
    usersWithActiveTasks: [],
    isLoading: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    try {
      this.setState({ isLoading: true });
      const users = await getUsers();
      const activeUsers = users.filter(u => u.isActive);
      const usersWithActiveTasks = this.props.project
        ? await getUsersWithActiveTasks(this.props.project.name)
        : [];
      const sortedUsers = _.sortBy(activeUsers, "lastName");
      this.setState({
        users: sortedUsers,
        usersWithActiveTasks,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  transferAllActiveTasks = async () => {
    if (!this.state.selectedUser || !this.props.project) {
      return;
    }
    try {
      const selectedUser = this.state.selectedUser;
      await transferActiveTasksOfProject(this.props.project.name, selectedUser.id);
      if (selectedUser) {
        Toast.success(
          `${messages["project.successful_active_tasks_transfer"]} ${selectedUser.lastName}, ${
            selectedUser.firstName
          }`,
        );
      }
      this.props.onComplete();
    } catch (e) {
      Toast.error(messages["project.unsuccessful_active_tasks_transfer"]);
    }
  };

  renderTableContent() {
    const activeUsersWithKey = this.state.usersWithActiveTasks.map(activeUser => ({
      email: activeUser.email,
      activeTasks: activeUser.activeTasks,
      key: activeUser.email,
    }));
    const columns = [
      {
        title: "User Email",
        dataIndex: "email",
        key: "email",
      },
      {
        title: "Number of Active Tasks",
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

  render() {
    const project = this.props.project;
    if (!project) {
      return (
        <Modal title="Error" visible onOk={this.props.onCancel} onCancel={this.props.onCancel}>
          <p>{messages["project.none_selected"]}</p>
        </Modal>
      );
    } else {
      const title = `All users with open tasks of ${project.name}`;
      return (
        <Modal
          title={title}
          visible
          onCancel={this.props.onCancel}
          pagination="false"
          footer={
            <div>
              <Button
                type="primary"
                disabled={!this.state.selectedUser}
                onClick={this.transferAllActiveTasks}
              >
                Transfer all tasks
              </Button>
              <Button onClick={this.props.onCancel}>Close</Button>
            </div>
          }
        >
          <div>
            {this.state.isLoading ? <Spin size="large" /> : this.renderTableContent()}
            <br />
            <br />
          </div>
          Select a user to transfer the tasks to:
          <div className="control-group">
            <div className="form-group">
              <UserSelectionComponent handleSelection={this.handleSelectChange} />
            </div>
          </div>
        </Modal>
      );
    }
  }
}

export default TransferAllTasksModal;
