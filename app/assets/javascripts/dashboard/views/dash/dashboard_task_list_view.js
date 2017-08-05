// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import React from "react";
import Request from "libs/request";
import { Table } from "antd";
import type { APITaskWithAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import moment from "moment";
import Toast from "libs/toast";
import app from "app";

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
  } = {
    showFinishedTasks: false,
    finishedTasks: [],
    unfinishedTasks: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  getFinishVerb = () => (this.state.showFinishedTasks ? "unfinished" : "finished");

  finish(task: APITaskWithAnnotationType) {
    if (!confirm("Are you sure you want to permanently finish this tracing?")) {
      return;
    }
    const annotation = task.annotation;
    const url = `/annotations/${annotation.typ}/${annotation.id}/finish`;

    Request.receiveJSON(url).then(changedAnnotationWithTask => {
      const changedTask = convertAnnotationToTaskWithAnnotationType(changedAnnotationWithTask);

      const newUnfinishedTasks = this.state.unfinishedTasks.filter(t => t.id !== task.id);
      const newFinishedTasks = [changedTask].concat(this.state.finishedTasks);

      this.setState({
        unfinishedTasks: newUnfinishedTasks,
        finishedTasks: newFinishedTasks,
      });
    });
  }

  async fetchData(): Promise<void> {
    const isFinished = this.state.showFinishedTasks;
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/tasks?isFinished=${isFinished.toString()}`
      : `/api/user/tasks?isFinished=${isFinished.toString()}`;
    const annotationsWithTasks = await Request.receiveJSON(url);

    const tasks = annotationsWithTasks.map(convertAnnotationToTaskWithAnnotationType);

    if (isFinished) {
      this.setState({
        finishedTasks: tasks,
      });
    } else {
      this.setState({
        unfinishedTasks: tasks,
      });
    }
  }

  toggleShowFinished = () => {
    this.setState({ showFinishedTasks: !this.state.showFinishedTasks }, () => this.fetchData());
  };

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
              <strong>trace</strong>
            </a>
          </li>
          {this.props.isAdminView
            ? <div>
                <li>
                  <a href={`/annotations/Task/${annotation.id}/transfer`}>
                    <i className="fa fa-share" />
                    transfer
                  </a>
                </li>
                <li>
                  <a href={`/annotations/Task/${annotation.id}/download`}>
                    <i className="fa fa-download" />
                    download
                  </a>
                </li>
                <li>
                  <a href="#" onClick={() => this.resetTask(annotation.id)}>
                    <i className="fa fa-undo" />
                    reset
                  </a>
                </li>
                <li>
                  <a href="#" onClick={() => this.cancelAnnotation(annotation.id)}>
                    <i className="fa fa-trash-o" />
                    cancel
                  </a>
                </li>
              </div>
            : <li>
                <a href="#" onClick={() => this.finish(task)}>
                  <i className="fa fa-check-circle-o" />
                  finish
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
    if (confirm("Do you really want to cancel this annotation?")) {
      Request.triggerRequest(`/annotations/Task/${annotationId}`, { method: "DELETE" }).then(() => {
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
      });
    }
  }

  async getNewTask() {
    if (this.state.unfinishedTasks.length === 0 || confirm("Do you really want another task?")) {
      app.router.showLoadingSpinner();
      try {
        const newTaskAnnotation = await Request.receiveJSON("/user/tasks/request");

        this.setState({
          unfinishedTasks: this.state.unfinishedTasks.concat([
            convertAnnotationToTaskWithAnnotationType(newTaskAnnotation),
          ]),
        });
      } finally {
        app.router.hideLoadingSpinner();
      }
    }
  }

  getCurrentTasks() {
    return this.state.showFinishedTasks ? this.state.finishedTasks : this.state.unfinishedTasks;
  }

  render() {
    return (
      <div>
        <h3>Tasks</h3>
        {this.props.isAdminView
          ? <a
              href={jsRoutes.controllers.AnnotationIOController.userDownload(this.props.userID).url}
              className="btn btn-primary"
              title="download all finished tracings"
            >
              <i className="fa fa-download" />download
            </a>
          : <a href="#" className="btn btn-success" onClick={() => this.getNewTask()}>
              Get a new task
            </a>}
        <div className="divider-vertical" />
        <a href="#" className="btn btn-default" onClick={this.toggleShowFinished}>
          Show {this.getFinishVerb()} tasks only
        </a>

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
            sorter
            className="monospace-id"
          />
          <Column title="Type" dataIndex="type.summary" sorter />
          <Column title="Project" dataIndex="projectName" sorter />
          <Column title="Description" dataIndex="type.description" sorter />
          <Column
            title="Modes"
            dataIndex="type.settings.allowedModes"
            sorter
            render={modes =>
              modes.map(mode =>
                <span className="label-default label" key={mode}>
                  {mode}
                </span>,
              )}
          />
          <Column
            title="Created"
            dataIndex="created"
            sorter
            render={created => moment(created).format("YYYY-MM-DD HH:SS")}
          />
          <Column
            title="Actions"
            className="nowrap"
            render={(__, task) => this.renderActions(task)}
          />
        </Table>

        <div className="modal-container" />
      </div>
    );
  }
}
