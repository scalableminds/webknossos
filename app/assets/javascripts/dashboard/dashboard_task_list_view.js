// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import { Button, Modal, Tag, Icon, Card, Row, Col, List } from "antd";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { connect } from "react-redux";
import Markdown from "react-remarkable";
import * as React from "react";
import classNames from "classnames";

import type { APITaskWithAnnotation, APIUser, APIAnnotation } from "admin/api_flow_types";
import { AsyncButton } from "components/async_clickables";
import type { OxalisState } from "oxalis/store";
import {
  deleteAnnotation,
  resetAnnotation,
  finishTask,
  requestTask,
  peekNextTasks,
} from "admin/admin_rest_api";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { handleGenericError } from "libs/error_handling";
import FormattedDate from "components/formatted_date";
import Persistence from "libs/persistence";
import Request from "libs/request";
import Toast from "libs/toast";
import TransferTaskModal from "dashboard/transfer_task_modal";
import * as Utils from "libs/utils";
import messages from "messages";

const typeHint: APITaskWithAnnotation[] = [];

type StateProps = {
  activeUser: APIUser,
};

type Props = {
  userId: ?string,
  isAdminView: boolean,
  history: RouterHistory,
} & StateProps;

type State = {
  showFinishedTasks: boolean,
  finishedTasks: Array<APITaskWithAnnotation>,
  unfinishedTasks: Array<APITaskWithAnnotation>,
  isLoading: boolean,
  isTransferModalVisible: boolean,
  currentAnnotationId: ?string,
};

const persistence: Persistence<State> = new Persistence(
  { showFinishedTasks: PropTypes.bool },
  "dashboardTaskList",
);

const convertAnnotationToTaskWithAnnotationType = (
  annotation: APIAnnotation,
): APITaskWithAnnotation => {
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

  const newTask: APITaskWithAnnotation = Object.assign({}, task, {
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

  confirmFinish(task: APITaskWithAnnotation) {
    Modal.confirm({
      content: messages["annotation.finish"],
      onOk: async () => {
        const { annotation } = task;

        const changedAnnotationWithTask = await finishTask(annotation.id);

        const changedTask = convertAnnotationToTaskWithAnnotationType(changedAnnotationWithTask);

        this.setState(prevState => {
          const newUnfinishedTasks = prevState.unfinishedTasks.filter(t => t.id !== task.id);
          const newFinishedTasks = [changedTask].concat(prevState.finishedTasks);

          return {
            unfinishedTasks: newUnfinishedTasks,
            finishedTasks: newFinishedTasks,
          };
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
    this.setState(
      prevState => ({ showFinishedTasks: !prevState.showFinishedTasks }),
      () => this.fetchData(),
    );
  };

  openTransferModal(annotationId: string) {
    this.setState({
      isTransferModalVisible: true,
      currentAnnotationId: annotationId,
    });
  }

  renderActions = (task: APITaskWithAnnotation) => {
    const { annotation } = task;
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
              <Icon type="delete" />Reset and Cancel
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

  resetTask(annotation: APIAnnotation) {
    Modal.confirm({
      content: messages["task.confirm_reset"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: async () => {
        await resetAnnotation(annotation.id, annotation.typ);
        Toast.success(messages["annotation.reset_success"]);
      },
    });
  }

  cancelAnnotation(annotation: APIAnnotation) {
    const wasFinished = this.state.showFinishedTasks;
    const annotationId = annotation.id;

    Modal.confirm({
      content: messages["annotation.delete"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: async () => {
        await deleteAnnotation(annotationId, annotation.typ);
        if (wasFinished) {
          this.setState(prevState => ({
            finishedTasks: prevState.finishedTasks.filter(t => t.annotation.id !== annotationId),
          }));
        } else {
          this.setState(prevState => ({
            unfinishedTasks: prevState.unfinishedTasks.filter(
              t => t.annotation.id !== annotationId,
            ),
          }));
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

      this.setState(prevState => ({
        unfinishedTasks: prevState.unfinishedTasks.concat([
          convertAnnotationToTaskWithAnnotationType(newTaskAnnotation),
        ]),
      }));
    } catch (ex) {
      // catch exception so that promise does not fail and the modal will close
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleTransferredTask() {
    this.setState({ isTransferModalVisible: false });

    const removeTransferredTask = (tasks, currentAnnotationId) =>
      tasks.filter(t => t.annotation.id !== currentAnnotationId);

    if (this.state.showFinishedTasks) {
      this.setState(prevState => ({
        finishedTasks: removeTransferredTask(
          prevState.finishedTasks,
          prevState.currentAnnotationId,
        ),
      }));
    } else {
      this.setState(prevState => ({
        unfinishedTasks: removeTransferredTask(
          prevState.unfinishedTasks,
          prevState.currentAnnotationId,
        ),
      }));
    }
  }

  getCurrentTasks() {
    return this.state.showFinishedTasks ? this.state.finishedTasks : this.state.unfinishedTasks;
  }

  renderPlaceholder() {
    return this.state.isLoading
      ? null
      : 'You have no assigned tasks. Request a new task by clicking on the "Get a New Task" button.';
  }

  renderTaskList() {
    const tasks = this.getCurrentTasks().sort(
      Utils.compareBy(
        typeHint,
        task => (this.state.showFinishedTasks ? task.annotation.modified : task.created),
        false,
      ),
    );
    const descriptionClassName = classNames("task-type-description", {
      short: this.state.showFinishedTasks || this.props.isAdminView,
    });

    const TaskCardTitle = ({ task }) => (
      <React.Fragment>
        <span style={{ marginRight: 8 }}>
          {task.type.summary} (<FormattedDate timestamp={task.created} />)
        </span>
        {task.type.settings.allowedModes.map(mode => <Tag key={mode}>{mode}</Tag>)}
      </React.Fragment>
    );

    const TaskCard = task =>
      this.state.showFinishedTasks ? (
        <Card key={task.id} style={{ margin: "10px" }}>
          <Row gutter={16}>
            <Col span={7}>
              <b>Task ID:</b> {task.id}
            </Col>
            <Col span={7}>
              <b>Project:</b> {task.projectName}
            </Col>
            <Col span={7}>
              <b>Finished:</b> <FormattedDate timestamp={task.annotation.modified} />
            </Col>
            <Col span={3}>{this.renderActions(task)}</Col>
          </Row>
        </Card>
      ) : (
        <Card key={task.id} title={<TaskCardTitle task={task} />} style={{ margin: "10px" }}>
          <Row gutter={16}>
            <Col span={16}>
              <div className={descriptionClassName}>
                <Markdown
                  source={task.type.description}
                  options={{ html: false, breaks: true, linkify: true }}
                />
              </div>
            </Col>
            <Col span={8}>
              <p style={{ marginBottom: 14 }}>
                <b>Task ID:</b> {task.id}
                <br />
                <b>Project:</b> {task.projectName}
              </p>
              {this.renderActions(task)}
            </Col>
          </Row>
        </Card>
      );

    return (
      <List
        dataSource={tasks}
        pagination={{
          defaultPageSize: 50,
        }}
        loading={this.state.isLoading}
        renderItem={TaskCard}
        locale={{ emptyText: this.renderPlaceholder() }}
      />
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
          {this.state.showFinishedTasks ? "Finished" : null} Tasks
        </h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />
        {this.renderTaskList()}
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
