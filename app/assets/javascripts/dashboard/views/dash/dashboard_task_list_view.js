// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import React from "react";
import Request from "libs/request";
import { Spin, Table, Button, Modal } from "antd";
import type { APITaskWithAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import Utils from "libs/utils";
import moment from "moment";
import Toast from "libs/toast";
import TransferTaskModal from "./transfer_task_modal";

const { Column } = Table;

type Props = {
  userID: ?string,
  isAdminView: boolean,
};

const convertAnnotationToTaskWithAnnotationType = (annotation): APITaskWithAnnotationType => {
  const { task } = annotation;

  if (!task) {
    // This should never be the case unless tasks were deleted in the DB.
    console.warn(
      `[Dashboard Tasks] Annotation ${annotation.id} has no task assigned. Please inform your admin.`,
    );
    return null;
  }

  if (!task.type) {
    task.type = {
      summary: `[deleted] ${annotation.typ}`,
      description: "",
      settings: { allowedModes: "" },
    };
  }

  task.annotation = annotation;
  return task;
};

export default class DashboardTaskListView extends React.PureComponent {
  props: Props;
  state: {
    showFinishedTasks: boolean,
    finishedTasks: Array<APITaskWithAnnotationType>,
    unfinishedTasks: Array<APITaskWithAnnotationType>,
    isLoading: boolean,
    isTransferModalVisible: boolean,
    currentAnnotationId: ?string,
  } = {
    showFinishedTasks: false,
    finishedTasks: [],
    unfinishedTasks: [],
    isLoading: false,
    isTransferModalVisible: false,
    currentAnnotationId: null,
  };

  componentDidMount() {
    this.fetchData();
  }

  getFinishVerb = () => (this.state.showFinishedTasks ? "Unfinished" : "Finished");

  finish(task: APITaskWithAnnotationType) {
    Modal.confirm({
      content: "Are you sure you want to permanently finish this tracing?",
      onOk: async () => {
        const annotation = task.annotation;
        const url = `/annotations/${annotation.typ}/${annotation.id}/finish`;

        const changedAnnotationWithTask = await Request.receiveJSON(url);
        const changedTask = convertAnnotationToTaskWithAnnotationType(changedAnnotationWithTask);

        const newUnfinishedTasks = this.state.unfinishedTasks.filter(t => t.id !== task.id);
        const newFinishedTasks = [changedTask].concat(this.state.finishedTasks);

        this.setState({
          unfinishedTasks: newUnfinishedTasks,
          finishedTasks: newFinishedTasks,
        });
      },
    });
  }

  async fetchData(): Promise<void> {
    this.setState({ isLoading: true });
    const isFinished = this.state.showFinishedTasks;
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/tasks?isFinished=${isFinished.toString()}`
      : `/api/user/tasks?isFinished=${isFinished.toString()}`;
    const annotationsWithTasks = await Request.receiveJSON(url);

    const tasks = annotationsWithTasks.map(convertAnnotationToTaskWithAnnotationType);

    this.setState({
      [isFinished ? "finishedTasks" : "unfinishedTasks"]: tasks,
      isLoading: false,
    });
  }

  toggleShowFinished = () => {
    this.setState({ showFinishedTasks: !this.state.showFinishedTasks }, () => this.fetchData());
  };

  openTransferModal(annotationId: string) {
    this.setState({
      isTransferModalVisible: true,
      currentAnnotationId: annotationId,
    });
  }

  renderActions = (task: APITaskWithAnnotationType) => {
    const annotation = task.annotation;
    return task.annotation.state.isFinished
      ? <div>
          <i className="fa fa-check" />
          <span> Finished</span>
          <br />
        </div>
      : <ul>
          <li>
            <a href={`/annotations/Task/${annotation.id}`}>
              <i className="fa fa-random" />
              <strong>Trace</strong>
            </a>
          </li>
          {this.props.isAdminView
            ? <div>
                <li>
                  <a href="#" onClick={() => this.openTransferModal(annotation.id)}>
                    <i className="fa fa-share" />
                    Transfer
                  </a>
                </li>
                <li>
                  <a href={`/annotations/Task/${annotation.id}/download`}>
                    <i className="fa fa-download" />
                    Download
                  </a>
                </li>
                <li>
                  <a href="#" onClick={() => this.resetTask(annotation.id)}>
                    <i className="fa fa-undo" />
                    Reset
                  </a>
                </li>
                <li>
                  <a href="#" onClick={() => this.cancelAnnotation(annotation.id)}>
                    <i className="fa fa-trash-o" />
                    Cancel
                  </a>
                </li>
              </div>
            : <li>
                <a href="#" onClick={() => this.finish(task)}>
                  <i className="fa fa-check-circle-o" />
                  Finish
                </a>
              </li>}
        </ul>;
  };

  resetTask(annotationId: string) {
    const url = `/annotations/Task/${annotationId}/reset`;

    Request.receiveJSON(url).then(jsonData => {
      Toast.message(jsonData.messages);
    });
  }

  cancelAnnotation(annotationId: string) {
    const wasFinished = this.state.showFinishedTasks;

    Modal.confirm({
      content: "Do you really want to cancel this annotation?",
      onOk: async () => {
        await Request.triggerRequest(`/annotations/Task/${annotationId}`, { method: "DELETE" });
        if (wasFinished) {
          this.setState({
            finishedTasks: this.state.finishedTasks.filter(t => t.annotation.id !== annotationId),
          });
        } else {
          this.setState({
            unfinishedTasks: this.state.unfinishedTasks.filter(
              t => t.annotation.id !== annotationId,
            ),
          });
        }
      },
    });
  }

  confirmGetNewTask() {
    if (this.state.unfinishedTasks.length === 0) {
      this.getNewTask();
    } else {
      Modal.confirm({
        content: "Are you sure you want to permanently finish this tracing?",
        onOk: () => this.getNewTask(),
      });
    }
  }

  async getNewTask() {
    this.setState({ isLoading: true });
    try {
      const newTaskAnnotation = await Request.receiveJSON("/user/tasks/request");

      this.setState({
        unfinishedTasks: this.state.unfinishedTasks.concat([
          convertAnnotationToTaskWithAnnotationType(newTaskAnnotation),
        ]),
      });
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleTransferredTask() {
    this.setState({ isTransferModalVisible: false });

    const removeTransferredTask = tasks =>
      tasks.filter(t => t.annotation.id !== this.state.currentAnnotationId);

    if (this.state.showFinishedTasks) {
      this.setState({
        finishedTasks: removeTransferredTask(this.state.finishedTasks),
      });
    } else {
      this.setState({
        unfinishedTasks: removeTransferredTask(this.state.unfinishedTasks),
      });
    }
  }

  getCurrentTasks() {
    return this.state.showFinishedTasks ? this.state.finishedTasks : this.state.unfinishedTasks;
  }

  renderTable() {
    return (
      <Table
        dataSource={this.getCurrentTasks().filter(
          task => task.annotation.state.isFinished === this.state.showFinishedTasks,
        )}
        rowKey="name"
        pagination={{
          defaultPageSize: 50,
        }}
      >
        <Column
          title="#"
          dataIndex="id"
          render={(__, task) => FormatUtils.formatHash(task.id)}
          sorter={Utils.localeCompareBy("id")}
          className="monospace-id"
        />
        <Column
          title="Type"
          dataIndex="type.summary"
          sorter={Utils.localeCompareBy(t => t.type.summary)}
        />
        <Column
          title="Project"
          dataIndex="projectName"
          sorter={Utils.localeCompareBy("projectName")}
        />
        <Column
          title="Description"
          dataIndex="type.description"
          sorter={Utils.localeCompareBy(t => t.type.description)}
        />
        <Column
          title="Modes"
          dataIndex="type.settings.allowedModes"
          sorter={Utils.localeCompareBy(t => t.type.settings.allowedModes.join("-"))}
          render={modes =>
            modes.map(mode =>
              <span className="label-default label" key={mode}>
                {mode}
              </span>,
            )}
        />
        <Column
          title="Creation Date"
          dataIndex="created"
          sorter={Utils.localeCompareBy("created")}
          render={created => moment(created).format("YYYY-MM-DD HH:SS")}
        />
        <Column
          title="Actions"
          className="nowrap"
          render={(__, task) => this.renderActions(task)}
        />
      </Table>
    );
  }

  render() {
    return (
      <div>
        <h3>Tasks</h3>
        <div style={{ marginBottom: 20 }}>
          {this.props.isAdminView && this.props.userID
            ? <a href={`/api/users/${this.props.userID}/annotations/download`}>
                <Button icon="download">Download All Finished Tracings</Button>
              </a>
            : <Button type="primary" onClick={() => this.confirmGetNewTask()}>
                Get a New Task
              </Button>}
          <div className="divider-vertical" />
          <Button onClick={this.toggleShowFinished}>
            Show {this.getFinishVerb()} Tasks Only
          </Button>
        </div>

        {this.state.isLoading
          ? <div className="text-center">
              <Spin size="large" />
            </div>
          : this.renderTable()}

        <TransferTaskModal
          visible={this.state.isTransferModalVisible}
          annotationId={this.state.currentAnnotationId}
          onCancel={() => this.setState({ isTransferModalVisible: false })}
          onChange={() => this.handleTransferredTask()}
          userID={this.props.userID}
        />
      </div>
    );
  }
}
