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
  userId: ?string,
};

type TableEntryType = {
  userName: string,
  numberOfTasks: number,
};

type State = {
  isLoading: boolean,
  users: Array<APIUserType>,
  currentUserIdValue: string,
  usersWithOpenTasks: Array<TableEntryType>,
};

class TransferAllTasksModal extends React.PureComponent<Props, State> {
  state = {
    isLoading: false,
    users: [],
    currentUserIdValue: "",
    usersWithOpenTasks: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    this.setState({ isLoading: true });
    const users = await getUsers();
    const usersWithOpenTasks = await this.fetchUsersWithOpenTasksMock();
    const activeUsers = users.filter(u => u.isActive);
    this.setState({ isLoading: false, usersWithOpenTasks });
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

  /* TODO get all users, and all the taskids that are open and fit to the project
  // !! make the show table compact -> size small !!
  // provide som mock-data to test atleast the table
  async fetchUsersWithOpenTasks() {
    const users = await getUsersWithOpenTaskOfProject(this.props.project.name);
    for (let i = 0; i < users.length; i++) {
      const currentUserEntry: TableEntry = {};
      const queryObject: QueryObjectType = {};
      queryObject.project = this.props.project.name;
      queryObject.user = this.state.users.find(user => user.email === users[i].email);
      if (queryObject.user) {
        // put request for tasks here
        const currentUsersTasks = getTasks(queryObject);
        currentUsersTasks.forEach(task => {
          // man muss nach annotations suchen
          // nach active tasks filtern
          // if(task.projectName === this.props.project.name // && task.status == ){
          // ){}); // here
          console.log("hi");
        });
        // else do nothing
      }
    }
  } */

  renderTableContent() {
    const columns = [
      {
        title: "User name",
        dataIndex: "userName",
        key: "userName",
      },
      {
        title: "number of open tasks",
        dataIndex: "numberOfTasks",
        key: "numberOfTasks",
      },
    ];
    return (
      <Table
        columns={columns}
        dataSource={this.state.usersWithOpenTasks}
        rowKey="userName"
        pagination={false}
        size="small"
      />
    );
  }

  // ** magic **
  /* async transfer() {
    return;
    // TODO put all relevant task ids into an array

    // const queryObject: QueryObjectType = {};

    /----------------------------------------
    const annotationId = this.props.annotationId;
    if (!annotationId) {
      throw new Error("No annotation id provided");
    }
    this.setState({ isLoading: true });
    // use bulkTaskTransfer
    const updatedAnnotation = await transferTask(annotationId, this.state.currentUserIdValue);
    this.setState({ isLoading: false });
    this.props.onChange(updatedAnnotation);
  } */

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

  // TODO own users does not show up !!
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
