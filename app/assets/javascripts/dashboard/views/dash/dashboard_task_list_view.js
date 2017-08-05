// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import React from "react";
import Request from "libs/request";
import { Table } from "antd";
import type { APITaskWithAnnotationType } from "admin/api_flow_types";
import FormatUtils from "libs/format_utils";
import moment from "moment";
import update from "immutability-helper";
import Toast from "libs/toast";
import app from "app";

const { Column } = Table;

type Props = {
  userID: ?string,
  isAdminView: boolean,
};

const cachedReceiveJSON = _.memoize(Request.receiveJSON);

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
    tasks: Array<APITaskWithAnnotationType>,
  } = {
    showFinishedTasks: false,
    tasks: [],
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

    Request.receiveJSON(url).then(__ => {
      // Only clear cache, but don't refetch
      cachedReceiveJSON.cache.clear();

      const newTasks = this.state.tasks.map(currentTask => {
        if (currentTask.id !== task.id) {
          return currentTask;
        } else {
          return update(task, { annotation: { state: { isFinished: { $set: true } } } });
        }
      });

      this.setState({ tasks: newTasks });
    });
  }

  fetchFresh(): Promise<void> {
    cachedReceiveJSON.cache.clear();
    return this.fetchData();
  }

  async fetchData(): Promise<void> {
    const isFinished = this.state.showFinishedTasks;
    const url = this.props.userID
      ? `/api/users/${this.props.userID}/tasks?isFinished=${isFinished.toString()}`
      : `/api/user/tasks?isFinished=${isFinished.toString()}`;
    const annotationsWithTasks = await cachedReceiveJSON(url);

    const tasks = annotationsWithTasks.map(convertAnnotationToTaskWithAnnotationType);

    this.setState({
      tasks,
    });
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
    if (confirm("Do you really want to cancel this annotation?")) {
      Request.triggerRequest(`/annotations/Task/${annotationId}`, { method: "DELETE" }).then(() =>
        this.fetchFresh(),
      );
    }
  }

  async getNewTask() {
    const unfinishedTasks = this.state.tasks.filter(t => !t.isFinished);
    if (unfinishedTasks.length === 0 || confirm("Do you really want another task?")) {
      app.router.showLoadingSpinner();
      try {
        const newTaskAnnotation = await Request.receiveJSON("/user/tasks/request");

        this.setState({
          tasks: this.state.tasks.concat([
            convertAnnotationToTaskWithAnnotationType(newTaskAnnotation),
          ]),
        });
        cachedReceiveJSON.cache.clear();
      } finally {
        app.router.hideLoadingSpinner();
      }
    }
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
          dataSource={this.state.tasks.filter(
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
