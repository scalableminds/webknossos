// @flow

import _ from "lodash";
import React from "react";
import { Table, Tag, Spin, Button, Input, Modal, Icon, Card } from "antd";
import Utils from "libs/utils";
import Toast from "libs/toast";
import AnonymousTaskLinkModal from "admin/views/task/anonymous_task_link_modal";
import TaskSearchForm from "admin/views/task/task_search_form";
import messages from "messages";
import { deleteTask } from "admin/admin_rest_api";
import TemplateHelpers from "libs/template_helpers";
import FormatUtils from "libs/format_utils";
import type { APITaskType, APITaskTypeType } from "admin/api_flow_types";
import Request from "libs/request";

const { Column } = Table;
const { Search } = Input;

type Props = {};

type State = {
  isLoading: boolean,
  tasks: Array<APITaskType>,
  searchQuery: string,
};

class TaskListView extends React.PureComponent<Props, State> {
  state = {
    isLoading: false,
    tasks: [],
    searchQuery: "",
  };

  componentDidMount() {
    const queryObject = {
      _id: { $oid: "598d8780cd682fff03a3b26a" },
    };
    this.fetchData(queryObject);
  }

  async fetchData(queryObject) {
    const responses = await Request.sendJSONReceiveJSON("/api/queries", {
      params: { type: "task" },
      data: queryObject,
    });

    const tasks = responses.map(response => {
      // apply some defaults
      response.type = {
        summary: Utils.__guard__(response.type, x => x.summary) || "<deleted>",
        id: Utils.__guard__(response.type, x1 => x1.id) || "",
      };

      if (response.tracingTime == null) {
        response.tracingTime = 0;
      }
      // convert bounding box
      if (response.boundingBox != null) {
        const { topLeft, width, height, depth } = response.boundingBox;
        response.boundingBox = topLeft.concat([width, height, depth]);
      } else {
        response.boundingBox = [];
      }

      return response;
    });

    this.setState({
      tasks,
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteTask = (task: APITaskType) => {
    Modal.confirm({
      title: messages["project.delete"],
      onOk: async () => {
        this.setState({
          isLoading: true,
        });

        await deleteTask(task.id);
        this.setState({
          isLoading: false,
          tasks: this.state.tasks.filter(t => t.id !== task.id),
        });
      },
    });
  };

  render() {
    const marginRight = { marginRight: 20 };

    return (
      <div className="container wide task-administration">
        <div style={{ marginTop: 20 }}>
          <div className="pull-right">
            <a href="/tasks/create">
              <Button icon="plus" style={marginRight} type="primary">
                Add Task
              </Button>
            </a>
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
            />
          </div>
          <h3>Tasks</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

          <Card title="Search for Tasks">
            <TaskSearchForm onChange={this.fetchData} />
          </Card>

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryAND(
                this.state.tasks,
                ["team", "projectName", "id", "dataSet", "created", "type", "experience"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Column title="#" dataIndex="id" key="id" sorter={Utils.localeCompareBy("id")} />
              <Column
                title="Project"
                dataIndex="projectName"
                key="projectName"
                sorter={Utils.localeCompareBy("projectName")}
                render={(projectName: string) => (
                  <a href={`/projects#${projectName}`}>{projectName}</a>
                )}
              />
              <Column
                title="Type"
                dataIndex="type"
                key="type"
                sorter={Utils.localeCompareBy((taskType: APITaskTypeType) => taskType.summary)}
                render={(taskType: APITaskTypeType) => (
                  <a href={`/taskTypes#${taskType.id}`}>{taskType.summary}</a>
                )}
              />
              <Column
                title="Dataset"
                dataIndex="dataSet"
                key="dataSet"
                sorter={Utils.localeCompareBy("dataSet")}
              />
              <Column
                title="Edit Position / Bounding Box"
                dataIndex="editPosition"
                key="editPosition"
                render={(__, task: APITaskType) => (
                  <div className="nowrap">
                    {TemplateHelpers.formatTuple(task.editPosition)} <br />
                    <span>{TemplateHelpers.formatTuple(task.boundingBox)}</span>
                  </div>
                )}
              />
              <Column
                title="Experience"
                dataIndex="neededExperience"
                key="neededExperience"
                sorter={Utils.localeCompareBy(neededExperience => neededExperience.domain)}
                render={neededExperience =>
                  neededExperience.domain !== "" || neededExperience.value > 0 ? (
                    <Tag>
                      {neededExperience.domain} : {neededExperience.value}
                    </Tag>
                  ) : null}
              />
              <Column
                title="Creation Date"
                dataIndex="created"
                key="created"
                sorter={Utils.localeCompareBy("created")}
              />
              <Column
                title="Stats"
                dataIndex="status"
                key="status"
                render={(status, task: APITaskType) => (
                  <div className="nowrap">
                    <span>
                      <Icon type="play-circle-o" />
                      {status.open}
                    </span>
                    <br />
                    <span>
                      <Icon type="fork" />
                      {status.inProgress}
                    </span>
                    <br />
                    <span>
                      <Icon type="check-circle-o" />
                      {status.completed}
                    </span>
                    <br />
                    <span>
                      <Icon type="clock-circle-o" />
                      {FormatUtils.formatSeconds(task.tracingTime / 1000)}
                    </span>
                  </div>
                )}
              />
              <Column
                title="Action"
                key="actions"
                render={(__, task: APITaskType) => (
                  <span>
                    {task.status.completed > 0 ? (
                      <a
                        href={`/annotations/CompoundTask/${task.id}`}
                        title="View all Finished Tracings"
                      >
                        <Icon type="eye-o" />View
                      </a>
                    ) : null}
                    <br />
                    <a href={`/tasks/${task.id}/edit`} title="Edit Project">
                      <Icon type="edit" />Edit
                    </a>
                    <br />
                    {task.status.completed > 0 ? (
                      <a
                        href={`/api/tasks/${task.id}/download`}
                        title="Download all Finished Tracings"
                      >
                        <Icon type="download" />Download
                      </a>
                    ) : null}
                    <br />
                    <a href="#" onClick={_.partial(this.deleteTask, task)}>
                      <Icon type="delete" />Delete
                    </a>
                  </span>
                )}
              />
            </Table>
          </Spin>
        </div>
      </div>
    );
  }
}

// createNewTask() {
//   let urlParam;
//   const id = this.collection.fullCollection.taskTypeId;
//   const name = this.collection.fullCollection.projectName;
//   if (name) {
//     urlParam = `?projectName=${name}`;
//   } else if (id) {
//     urlParam = `?taskType=${id}`;
//   } else {
//     urlParam = "";
//   }

//   // The trailing '#' is important for routing
//   app.router.navigate(`/tasks/create${urlParam}#`, { trigger: true });
// }

// showAnonymousLinks() {
//   const anonymousTaskId = Utils.getUrlParams("showAnonymousLinks");
//   if (!anonymousTaskId) {
//     return;
//   }

//   const task = this.collection.findWhere({ id: anonymousTaskId });
//   if (task && task.get("directLinks")) {
//     this.showModal(task);
//   } else {
//     Toast.error(`Unable to find anonymous links for task ${anonymousTaskId}.`);
//   }
// }

// showModal(task) {
//   const modalView = new AnonymousTaskLinkModal({ model: task });
//   modalView.render();
//   this.ui.modalWrapper.html(modalView.el);

//   modalView.show();
//   this.modalView = modalView;
// }

export default TaskListView;
