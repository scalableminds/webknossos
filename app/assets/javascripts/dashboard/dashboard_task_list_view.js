// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import * as React from "react";
import { connect } from "react-redux";
import { Link, withRouter } from "react-router-dom";
import Request from "libs/request";
import { AsyncButton } from "components/async_clickables";
import { Spin, Table, Button, Modal, Tag, Icon } from "antd";
import Markdown from "react-remarkable";
import Utils from "libs/utils";
import moment from "moment";
import Toast from "libs/toast";
import messages from "messages";
import TransferTaskModal from "dashboard/transfer_task_modal";
import {
  deleteAnnotation,
  resetAnnotation,
  finishTask,
  requestTask,
  peekNextTasks,
} from "admin/admin_rest_api";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import type {
  APITaskWithAnnotationType,
  APIUserType,
  APIAnnotationType,
} from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import type { RouterHistory } from "react-router-dom";
import { handleGenericError } from "libs/error_handling";

const { Column } = Table;

const typeHint: APITaskWithAnnotationType[] = [];

type StateProps = {
  activeUser: APIUserType,
};

type Props = {
  userId: ?string,
  isAdminView: boolean,
  history: RouterHistory,
} & StateProps;

type State = {
  showFinishedTasks: boolean,
  finishedTasks: Array<APITaskWithAnnotationType>,
  unfinishedTasks: Array<APITaskWithAnnotationType>,
  isLoading: boolean,
  isTransferModalVisible: boolean,
  currentAnnotationId: ?string,
};

const persistence: Persistence<State> = new Persistence(
  { showFinishedTasks: PropTypes.bool },
  "dashboardTaskList",
);

const convertAnnotationToTaskWithAnnotationType = (
  annotation: APIAnnotationType,
): APITaskWithAnnotationType => {
  const { task } = annotation;

  if (!task) {
    // This should never be the case unless tasks were deleted in the DB.
    throw new Error(
      `[Dashboard Tasks] Annotation ${
        annotation.id
      } has no task assigned. Please inform your admin.`,
    );
  }

  if (!task.type) {
    task.type = {
      summary: `[deleted] ${annotation.typ}`,
      description: "",
      settings: { allowedModes: "" },
    };
  }

  const newTask: APITaskWithAnnotationType = Object.assign({}, task, {
    annotation,
  });
  return newTask;
};

class DashboardTaskListView extends React.PureComponent<Props, State> {
  state = {
    showFinishedTasks: false,
    finishedTasks: [],
    unfinishedTasks: [],
    isLoading: false,
    isTransferModalVisible: false,
    currentAnnotationId: null,
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  getFinishVerb = () => (this.state.showFinishedTasks ? "Unfinished" : "Finished");

  confirmFinish(task: APITaskWithAnnotationType) {
    Modal.confirm({
      content: messages["annotation.finish"],
      onOk: async () => {
        const annotation = task.annotation;

        const changedAnnotationWithTask = await finishTask(annotation.id);

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
    const isFinished = this.state.showFinishedTasks;
    const url = this.props.userId
      ? `/api/users/${this.props.userId}/tasks?isFinished=${isFinished.toString()}`
      : `/api/user/tasks?isFinished=${isFinished.toString()}`;

    try {
      this.setState({ isLoading: true });
      const annotationsWithTasks = await Request.receiveJSON(url);
      const tasks = annotationsWithTasks.map(convertAnnotationToTaskWithAnnotationType);

      this.setState({
        [isFinished ? "finishedTasks" : "unfinishedTasks"]: tasks,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
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
    const isAdmin =
      this.props.activeUser.isAdmin ||
      this.props.activeUser.teams
        .filter(team => team.isTeamManager)
        .map(team => team.name)
        .includes(task.team);

    // TODO use React fragments <> instead of spans / divs
    const label = this.props.isAdminView ? (
      <span>
        <Icon type="eye-o" />View
      </span>
    ) : (
      <span>
        <Icon type="play-circle-o" />Trace
      </span>
    );

    return task.annotation.state === "Finished" ? (
      <div>
        <Icon type="check-circle-o" />Finished
        <br />
      </div>
    ) : (
      <div>
        <Link to={`/annotations/Task/${annotation.id}`}>{label}</Link>
        <br />
        {isAdmin || this.props.isAdminView ? (
          <div>
            <a href="#" onClick={() => this.openTransferModal(annotation.id)}>
              <Icon type="team" />Transfer
            </a>
            <br />
          </div>
        ) : null}
        {isAdmin ? (
          <div>
            <a href={`/api/annotations/Task/${annotation.id}/download`}>
              <Icon type="download" />Download
            </a>
            <br />
            <a href="#" onClick={() => this.resetTask(annotation)}>
              <Icon type="rollback" />Reset
            </a>
            <br />
            <a href="#" onClick={() => this.cancelAnnotation(annotation)}>
              <Icon type="delete" />Cancel
            </a>
            <br />
          </div>
        ) : null}
        {this.props.isAdminView ? null : (
          <a href="#" onClick={() => this.confirmFinish(task)}>
            <Icon type="check-circle-o" />Finish
          </a>
        )}
      </div>
    );
  };

  async resetTask(annotation: APIAnnotationType) {
    await resetAnnotation(annotation.id, annotation.typ);
    Toast.success(messages["task.reset_success"]);
  }

  cancelAnnotation(annotation: APIAnnotationType) {
    const wasFinished = this.state.showFinishedTasks;
    const annotationId = annotation.id;

    Modal.confirm({
      content: messages["annotation.delete"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: async () => {
        await deleteAnnotation(annotationId, annotation.typ);
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

  async confirmGetNewTask(): Promise<void> {
    if (this.state.unfinishedTasks.length === 0) {
      return this.getNewTask();
    } else {
      let modalContent = messages["task.request_new"];
      const likelyNextTask = await peekNextTasks();

      if (likelyNextTask != null) {
        modalContent += `\n${messages["task.peek_next"]({
          projectName: likelyNextTask.projectName,
        })}`;
      }

      return Modal.confirm({
        content: modalContent,
        onOk: () => this.getNewTask(),
      });
    }
  }

  async getNewTask() {
    this.setState({ isLoading: true });
    try {
      const newTaskAnnotation = await requestTask();

      this.setState({
        unfinishedTasks: this.state.unfinishedTasks.concat([
          convertAnnotationToTaskWithAnnotationType(newTaskAnnotation),
        ]),
      });
    } catch (ex) {
      // catch exception so that promise does not fail and the modal will close
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
        dataSource={this.getCurrentTasks().filter(task => {
          if (this.state.showFinishedTasks) return task.annotation.state === "Finished";
          else return task.annotation.state !== "Finished";
        })}
        rowKey="id"
        pagination={{
          defaultPageSize: 50,
        }}
        style={{ overflowX: "auto" }}
      >
        <Column
          title="ID"
          dataIndex="id"
          width={100}
          sorter={Utils.localeCompareBy(typeHint, "id")}
          className="monospace-id"
        />
        <Column
          title="Type"
          dataIndex="type.summary"
          width={150}
          sorter={Utils.localeCompareBy(typeHint, t => t.type.summary)}
        />
        <Column
          title="Project"
          dataIndex="projectName"
          width={150}
          sorter={Utils.localeCompareBy(typeHint, "projectName")}
        />
        <Column
          title="Description"
          dataIndex="type.description"
          sorter={Utils.localeCompareBy(typeHint, t => t.type.description)}
          render={description => (
            <div className="task-type-description">
              <Markdown
                source={description}
                options={{ html: false, breaks: true, linkify: true }}
              />
            </div>
          )}
          width={550}
        />
        <Column
          title="Modes"
          dataIndex="type.settings.allowedModes"
          width={150}
          sorter={Utils.localeCompareBy(typeHint, t => t.type.settings.allowedModes.join("-"))}
          render={modes => modes.map(mode => <Tag key={mode}>{mode}</Tag>)}
        />
        <Column
          title="Creation Date"
          dataIndex="created"
          width={150}
          sorter={Utils.localeCompareBy(typeHint, "created")}
          render={created => moment(created).format("YYYY-MM-DD HH:SS")}
        />
        <Column
          title="Actions"
          className="nowrap"
          width={150}
          render={(__, task) => this.renderActions(task)}
        />
      </Table>
    );
  }

  render() {
    return (
      <div>
        <div className="pull-right">
          <AsyncButton
            type="primary"
            icon="file-add"
            onClick={() => this.confirmGetNewTask()}
            disabled={this.props.isAdminView && this.props.userId}
          >
            Get a New Task
          </AsyncButton>
          <Button onClick={this.toggleShowFinished} style={{ marginLeft: 20 }}>
            Show {this.getFinishVerb()} Tasks Only
          </Button>
        </div>
        <h3 id="tasksHeadline" className="TestTasksHeadline">
          Tasks
        </h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />

        <Spin spinning={this.state.isLoading}>{this.renderTable()}</Spin>

        <TransferTaskModal
          visible={this.state.isTransferModalVisible}
          annotationId={this.state.currentAnnotationId}
          onCancel={() => this.setState({ isTransferModalVisible: false })}
          onChange={() => this.handleTransferredTask()}
          userId={this.props.userId}
        />
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(withRouter(DashboardTaskListView));
