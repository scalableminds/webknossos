// @flow

import _ from "lodash";
import * as React from "react";
import { Spin, Modal, Button, Select } from "antd";
import { getUsers, transferTask, getUsersWithOpenTaskOfProject, getTasks } from "admin/admin_rest_api";
import type { APIUserType, APIAnnotationType, APIProjectType } from "admin/api_flow_types";
import type { QueryObjectType } from "admin/task/task_search_form";

const { Option } = Select;

type Props = {
  onChange: (updatedAnnotation: APIAnnotationType) => void,
  annotationId: ?string,
  project: APIProjectType,
  onCancel: Function,
  visible: boolean,
  userId: ?string,
};

type State = {
  isLoading: boolean,
  users: Array<APIUserType>,
  currentUserIdValue: string,
};

type TableEntry = {
  userEmail: string,
  numberOfTasks: ?int,
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
    this.setState({ isLoading: true });
    const users = await getUsers();
    const activeUsers = users.filter(u => u.isActive);
    this.setState({ isLoading: false });
    const sortedUsers = _.sortBy(activeUsers, "lastName");

    this.setState({
      users: sortedUsers,
    });
  }

  // TODO get all users, and all the taskids that are open and fit to the project
  // !! make the show table compact -> size small !!
  // provide som mock-data to test atleast the table
  async fetchUsersWithOpenTasks() {
    const users = await getUsersWithOpenTaskOfProject(this.props.project.name);
    const taskIds: string[] = {}; // stores ids from tasks
    for (let i = 0; i < users.length; i++) {
      const currentUserEntry: TableEntry = {};
      const queryObject: QueryObjectType = {};
      queryObject.project = this.props.project.name;
      queryObject.user = this.state.users.find(user => user.email === users[i].email);
      if (queryObject.user) {
        // put request for tasks here
        const currentUsersTasks = getTasks(queryObject);
        currentUsersTasks.forEach((task) => {
          // man muss nach annotations suchen
          // nach active tasks filtern 
          if(task.projectName === this.props.project.name && task.status == ){

          }
        });

      }
      // else do nothing
    }
  }

  // ** magic **
  async transfer() {
    // TODO put all relevant task ids into an array

    // const queryObject: QueryObjectType = {};

    //--------------------------------------
    const annotationId = this.props.annotationId;
    if (!annotationId) {
      throw new Error("No annotation id provided");
    }
    this.setState({ isLoading: true });
    // use bulkTaskTransfer
    const updatedAnnotation = await transferTask(annotationId, this.state.currentUserIdValue);
    this.setState({ isLoading: false });
    this.props.onChange(updatedAnnotation);
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
