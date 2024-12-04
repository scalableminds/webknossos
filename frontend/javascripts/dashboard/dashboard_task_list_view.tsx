import { Button, Modal, Tag, Card, Row, Col, List, Tooltip } from "antd";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  PlayCircleOutlined,
  RollbackOutlined,
  TeamOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { connect } from "react-redux";
import Markdown from "libs/markdown_adapter";
import * as React from "react";

import classNames from "classnames";
import type { APITaskWithAnnotation, APIUser, APIAnnotation } from "types/api_flow_types";
import { AsyncButton, AsyncLink } from "components/async_clickables";
import type { OxalisState } from "oxalis/store";
import { deleteAnnotation, resetAnnotation, downloadAnnotation } from "admin/admin_rest_api";
import { finishTask, requestTask, peekNextTasks } from "admin/api/tasks";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { getSkeletonDescriptor } from "oxalis/model/accessors/skeletontracing_accessor";
import { getVolumeDescriptors } from "oxalis/model/accessors/volumetracing_accessor";
import { handleGenericError } from "libs/error_handling";
import FormattedDate from "components/formatted_date";
import LinkButton from "components/link_button";
import Persistence from "libs/persistence";
import Request from "libs/request";
import Toast from "libs/toast";
import TransferTaskModal from "dashboard/transfer_task_modal";
import * as Utils from "libs/utils";
import messages from "messages";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import { ActiveTabContext, RenderingTabContext } from "./dashboard_contexts";

const pageLength: number = 1000;

export type TaskModeState = {
  tasks: Array<APITaskWithAnnotation>;
  loadedAllTasks: boolean;
  lastLoadedPage: number;
};
type OwnProps = {
  userId: string | null | undefined;
  isAdminView: boolean;
};
type StateProps = {
  activeUser: APIUser;
};
type Props = OwnProps & StateProps;

type State = {
  showFinishedTasks: boolean;
  isLoading: boolean;
  isTransferModalOpen: boolean;
  currentAnnotationId: string | null | undefined;
  finishedModeState: TaskModeState;
  unfinishedModeState: TaskModeState;
};
const persistence = new Persistence<Pick<State, "showFinishedTasks">>(
  {
    showFinishedTasks: PropTypes.bool,
  },
  "dashboardTaskList",
);

const convertAnnotationToTaskWithAnnotationType = (
  annotation: APIAnnotation,
): APITaskWithAnnotation => {
  const { task } = annotation;

  if (!task) {
    // This should never be the case unless tasks were deleted in the DB.
    throw new Error(
      `[Dashboard Tasks] Annotation ${annotation.id} has no task assigned. Please inform your admin.`,
    );
  }

  if (!task.type) {
    // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'type' because it is a read-only ... Remove this comment to see the full error message
    task.type = {
      summary: `[deleted] ${annotation.typ}`,
      description: "",
      settings: {
        allowedModes: "",
      },
    };
  }

  const newTask: APITaskWithAnnotation = Object.assign({}, task, {
    annotation,
  });
  return newTask;
};

class DashboardTaskListView extends React.PureComponent<Props, State> {
  state: State = {
    showFinishedTasks: false,
    isLoading: false,
    isTransferModalOpen: false,
    currentAnnotationId: null,
    finishedModeState: {
      tasks: [],
      loadedAllTasks: false,
      lastLoadedPage: -1,
    },
    unfinishedModeState: {
      tasks: [],
      loadedAllTasks: false,
      lastLoadedPage: -1,
    },
  };

  componentDidMount() {
    // @ts-ignore
    this.setState(persistence.load());
    this.fetchNextPage(0);
  }

  componentDidUpdate() {
    persistence.persist(this.state);
  }

  getFinishVerb = () => (this.state.showFinishedTasks ? "Unfinished" : "Finished");
  getCurrentModeState = () =>
    this.state.showFinishedTasks ? this.state.finishedModeState : this.state.unfinishedModeState;

  setCurrentModeState = (modeShape: Partial<TaskModeState>) => {
    const { showFinishedTasks } = this.state;
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(prevState: Readonly<State>) => ... Remove this comment to see the full error message
    this.setState((prevState) => {
      const newSubState = {
        ...prevState[showFinishedTasks ? "finishedModeState" : "unfinishedModeState"],
        ...modeShape,
      };
      return {
        [showFinishedTasks ? "finishedModeState" : "unfinishedModeState"]: newSubState,
      };
    });
  };

  confirmFinish(task: APITaskWithAnnotation) {
    Modal.confirm({
      content: messages["annotation.finish"],
      onOk: async () => {
        const { annotation } = task;
        const changedAnnotationWithTask = await finishTask(annotation.id);
        const changedTask = convertAnnotationToTaskWithAnnotationType(changedAnnotationWithTask);
        this.setState((prevState) => {
          const newUnfinishedTasks = prevState.unfinishedModeState.tasks.filter(
            (t) => t.id !== task.id,
          );
          const newFinishedTasks = [changedTask].concat(prevState.finishedModeState.tasks);
          const newUnfinishedModeState = {
            ...prevState.unfinishedModeState,
            tasks: newUnfinishedTasks,
          };
          const newFinishedModeState = { ...prevState.finishedModeState, tasks: newFinishedTasks };
          return {
            unfinishedModeState: newUnfinishedModeState,
            finishedModeState: newFinishedModeState,
          };
        });
      },
    });
  }

  fetchNextPage = async (pageNumber: number) => {
    // this refers not to the pagination of antd but to the pagination of querying data from SQL
    const isFinished = this.state.showFinishedTasks;
    const previousTasks = this.getCurrentModeState().tasks;
    const url = this.props.userId
      ? `/api/users/${
          this.props.userId
        }/tasks?isFinished=${isFinished.toString()}&pageNumber=${pageNumber}`
      : `/api/user/tasks?isFinished=${isFinished.toString()}&pageNumber=${pageNumber}`;

    try {
      this.setState({
        isLoading: true,
      });
      const annotationsWithTasks = await Request.receiveJSON(url);
      const tasks = annotationsWithTasks.map(convertAnnotationToTaskWithAnnotationType);
      this.setCurrentModeState({
        loadedAllTasks:
          annotationsWithTasks.length !== pageLength || annotationsWithTasks.length === 0,
        tasks: previousTasks.concat(tasks),
        lastLoadedPage: pageNumber,
      });
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      this.setState({
        isLoading: false,
      });
    }
  };

  toggleShowFinished = () => {
    this.setState(
      (prevState) => ({
        showFinishedTasks: !prevState.showFinishedTasks,
      }),
      () => {
        if (this.getCurrentModeState().lastLoadedPage === -1) this.fetchNextPage(0);
      },
    );
  };

  openTransferModal(annotationId: string) {
    this.setState({
      isTransferModalOpen: true,
      currentAnnotationId: annotationId,
    });
  }

  renderActions = (task: APITaskWithAnnotation) => {
    const { annotation } = task;
    const isAdmin =
      this.props.activeUser.isAdmin ||
      this.props.activeUser.teams
        .filter((team) => team.isTeamManager)
        .map((team) => team.name)
        .includes(task.team);
    const label = this.props.isAdminView ? (
      <span>
        <EyeOutlined className="icon-margin-right" />
        View
      </span>
    ) : (
      <span>
        <PlayCircleOutlined className="icon-margin-right" />
        Open
      </span>
    );
    return task.annotation.state === "Finished" ? (
      <div>
        <CheckCircleOutlined className="icon-margin-right" />
        Finished
        <br />
      </div>
    ) : (
      <div>
        <Link to={`/annotations/${annotation.id}`}>{label}</Link>
        <br />
        {isAdmin || this.props.isAdminView ? (
          <div>
            <LinkButton onClick={() => this.openTransferModal(annotation.id)}>
              <TeamOutlined className="icon-margin-right" />
              Transfer
            </LinkButton>
            <br />
          </div>
        ) : null}
        {isAdmin ? (
          <div>
            <AsyncLink
              href="#"
              onClick={() => {
                const isVolumeIncluded = getVolumeDescriptors(annotation).length > 0;
                return downloadAnnotation(annotation.id, "Task", isVolumeIncluded);
              }}
              icon={<DownloadOutlined className="icon-margin-right" />}
            >
              Download
            </AsyncLink>
            <br />
            <LinkButton onClick={() => this.resetTask(annotation)}>
              <Tooltip title={messages["task.tooltip_explain_reset"]} placement="left">
                <RollbackOutlined className="icon-margin-right" />
                Reset
              </Tooltip>
            </LinkButton>
            <br />
            <LinkButton onClick={() => this.cancelAnnotation(annotation)}>
              <Tooltip title={messages["task.tooltip_explain_reset_cancel"]} placement="left">
                <DeleteOutlined className="icon-margin-right" />
                Reset and Cancel
              </Tooltip>
            </LinkButton>
            <br />
          </div>
        ) : null}
        {this.props.isAdminView ? null : (
          <LinkButton onClick={() => this.confirmFinish(task)}>
            <CheckCircleOutlined className="icon-margin-right" />
            Finish
          </LinkButton>
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
    const annotationId = annotation.id;
    Modal.confirm({
      content: messages["annotation.delete"],
      cancelText: messages.no,
      okText: messages.yes,
      onOk: async () => {
        await deleteAnnotation(annotationId, annotation.typ);
        this.setCurrentModeState({
          tasks: this.getCurrentModeState().tasks.filter((t) => t.annotation.id !== annotationId),
        });
      },
    });
  }

  async confirmGetNewTask(): Promise<void> {
    if (this.state.unfinishedModeState.tasks.length === 0) {
      this.getNewTask();
    } else {
      let modalContent = messages["task.request_new"];
      const likelyNextTask = await peekNextTasks();

      if (likelyNextTask != null) {
        modalContent += `\n${messages["task.peek_next"]({
          projectName: likelyNextTask.projectName,
        })}`;
      }

      Modal.confirm({
        content: modalContent,
        onOk: () => this.getNewTask(),
      });
    }
  }

  async getNewTask() {
    this.setState({
      isLoading: true,
    });

    try {
      const newTaskAnnotation = await requestTask();
      this.setState((prevState) => ({
        unfinishedModeState: {
          ...prevState.unfinishedModeState,
          tasks: prevState.unfinishedModeState.tasks.concat([
            convertAnnotationToTaskWithAnnotationType(newTaskAnnotation),
          ]),
        },
      }));
    } catch (_ex) {
      // catch exception so that promise does not fail and the modal will close
    } finally {
      this.setState({
        isLoading: false,
      });
    }
  }

  handleTransferredTask() {
    this.setState({
      isTransferModalOpen: false,
    });

    const removeTransferredTask = (
      tasks: APITaskWithAnnotation[],
      currentAnnotationId: string | null | undefined,
    ) => tasks.filter((t) => t.annotation.id !== currentAnnotationId);

    this.setCurrentModeState({
      tasks: removeTransferredTask(this.getCurrentTasks(), this.state.currentAnnotationId),
    });
  }

  getCurrentTasks() {
    return this.getCurrentModeState().tasks;
  }

  renderPlaceholder() {
    return this.state.isLoading ? null : (
      <Row gutter={32} justify="center">
        <Col span="7">
          <Card
            bordered={false}
            cover={<i className="drawing drawing-empty-list-tasks" style={{ translate: "15%" }} />}
            style={{ maxWidth: 460 }}
          >
            <Card.Meta
              title="Request a New Task"
              description={
                <>
                  <p style={{ marginTop: 20 }}>
                    You have no tasks assigned to you. Request a new task by clicking on the{" "}
                    <strong>Get a New Task</strong> button above.
                  </p>
                  {this.props.activeUser.isAdmin && (
                    <>
                      <p style={{ marginBottom: 30 }}>
                        Tasks are a powerful way to distribute annotation jobs among groups of users
                        as part of the WEBKNOSSOS project management.{" "}
                      </p>
                      <a
                        href="https://docs.webknossos.org/webknossos/tasks_projects/index.html"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <Button>Learn more</Button>
                      </a>
                      <Link to="/tasks">
                        <Button type="primary" style={{ marginLeft: 20 }}>
                          Create new Tasks
                        </Button>
                      </Link>
                    </>
                  )}
                </>
              }
            />
          </Card>
        </Col>
      </Row>
    );
  }

  renderTaskList() {
    const tasks = this.getCurrentTasks().sort(
      Utils.compareBy<APITaskWithAnnotation>(
        (task) => (this.state.showFinishedTasks ? task.annotation.modified : task.created),
        false,
      ),
    );
    const descriptionClassName = classNames("task-type-description", {
      short: this.state.showFinishedTasks || this.props.isAdminView,
    });

    const TaskCardTitle = ({ task }: { task: APITaskWithAnnotation }) => (
      <React.Fragment>
        <span
          style={{
            marginRight: 8,
          }}
        >
          {task.projectName} (<FormattedDate timestamp={task.created} />)
        </span>
        {getSkeletonDescriptor(task.annotation) == null ? null : <Tag color="green">skeleton</Tag>}
        {getVolumeDescriptors(task.annotation).length === 0 ? null : (
          <Tag color="orange">volume</Tag>
        )}
        {task.type.settings.allowedModes.map((mode) => (
          <Tag key={mode}>{mode}</Tag>
        ))}
      </React.Fragment>
    );

    const TaskCard = (task: APITaskWithAnnotation) =>
      this.state.showFinishedTasks ? (
        <Card
          key={task.id}
          style={{
            margin: "10px",
          }}
        >
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
        <Card
          key={task.id}
          title={<TaskCardTitle task={task} />}
          style={{
            margin: "10px",
          }}
        >
          <Row gutter={16}>
            <Col span={16}>
              <div className={descriptionClassName}>
                <Markdown>{task.type.description}</Markdown>
              </div>
            </Col>
            <Col span={8}>
              <p
                style={{
                  marginBottom: 14,
                }}
              >
                <b>Task ID:</b> {task.id}
                <br />
                <b>Task Type:</b> {task.type.summary}
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
        locale={{
          emptyText: this.renderPlaceholder(),
        }}
      />
    );
  }

  render() {
    return (
      <div>
        <TopBar
          confirmGetNewTask={() => this.confirmGetNewTask()}
          isAdminView={this.props.isAdminView}
          userId={this.props.userId}
          toggleShowFinished={this.toggleShowFinished}
          getFinishVerb={this.getFinishVerb}
        />
        <h3 id="tasksHeadline" className="TestTasksHeadline">
          {this.state.showFinishedTasks ? "My Finished Tasks" : null}
        </h3>
        {this.renderTaskList()}
        <div
          style={{
            textAlign: "right",
          }}
        >
          {!this.getCurrentModeState().loadedAllTasks ? (
            <Link
              to="#"
              onClick={() => this.fetchNextPage(this.getCurrentModeState().lastLoadedPage + 1)}
            >
              Load more Tasks
            </Link>
          ) : null}
        </div>
        <TransferTaskModal
          isOpen={this.state.isTransferModalOpen}
          annotationId={this.state.currentAnnotationId}
          onCancel={() =>
            this.setState({
              isTransferModalOpen: false,
            })
          }
          onChange={() => this.handleTransferredTask()}
        />
      </div>
    );
  }
}

function TopBar({
  confirmGetNewTask,
  isAdminView,
  userId,
  toggleShowFinished,
  getFinishVerb,
}: {
  confirmGetNewTask: () => Promise<void>;
  isAdminView: boolean;
  userId: string | null | undefined;
  toggleShowFinished: () => void;
  getFinishVerb: () => string;
}) {
  const activeTab = React.useContext(ActiveTabContext);
  const renderingTab = React.useContext(RenderingTabContext);

  const content = (
    <div className="pull-right">
      <AsyncButton
        type="primary"
        icon={<UserAddOutlined />}
        onClick={confirmGetNewTask}
        disabled={isAdminView && userId != null}
      >
        Get a New Task
      </AsyncButton>
      <Button
        onClick={toggleShowFinished}
        style={{
          marginLeft: 20,
        }}
      >
        Show {getFinishVerb()} Tasks Only
      </Button>
    </div>
  );

  return (
    <RenderToPortal portalId="dashboard-TabBarExtraContent">
      {activeTab === renderingTab ? content : null}
    </RenderToPortal>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

const connector = connect(mapStateToProps);
export default connector(DashboardTaskListView);
