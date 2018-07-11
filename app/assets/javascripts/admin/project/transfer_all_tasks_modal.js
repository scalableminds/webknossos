// @flow

import _ from "lodash";
import * as React from "react";
import { Spin, Modal, Button, Select, Table } from "antd";
import { getUsers } from "admin/admin_rest_api";
import type { APIUserType, APIProjectType } from "admin/api_flow_types";
import Toast from "libs/toast";
import messages from "messages";

const { Option } = Select;

type Props = {
  onSubmit: () => void,
  project: ?APIProjectType,
  onCancel: Function,
  visible: boolean,
};

type TableEntryType = {
  email: string,
  activeTasks: number,
};

type State = {
  isLoading: boolean,
  users: Array<APIUserType>,
  currentUserIdValue: string,
  usersWithActiveTasks: Array<TableEntryType>,
};

class TransferAllTasksModal extends React.PureComponent<Props, State> {
  state = {
    isLoading: false,
    users: [],
    currentUserIdValue: "",
    usersWithActiveTasks: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({ isLoading: true });
    const users = await getUsers();
    const activeUsers = users.filter(u => u.isActive);
    this.setState({ isLoading: false });
    const sortedUsers = _.sortBy(activeUsers, "lastName");
    this.setState({
      users: sortedUsers,
    });
  }

  fetchUsersWithOpenTasksMock = async () => [
    { userName: "Hans", numberOfTasks: 2, key: "Hans" },
    { userName: "Karla", numberOfTasks: 1, key: "Karla" },
    { userName: "Peter", numberOfTasks: 1, key: "Peter" },
    { userName: "Heinz-Günther", numberOfTasks: 3, key: "Heinz-Günther" },
  ];

  updateActiveUsers(activeUsers: Array<TableEntryType>) {
    const activeUsersWithKey = activeUsers.map(activeUser => {
      activeUser.key = activeUser.email;
      return activeUser;
    });
    this.setState({ usersWithActiveTasks: activeUsersWithKey });
  }

  renderTableContent() {
    const columns = [
      {
        title: "User's email",
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
        dataSource={this.state.usersWithActiveTasks}
        rowKey="email"
        pagination={false}
        size="small"
      />
    );
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
                disabled={this.state.currentUserIdValue === ""}
                onClick={() => this.props.onSubmit()}
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
