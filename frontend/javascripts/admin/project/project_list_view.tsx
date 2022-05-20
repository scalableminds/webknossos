import type { RouteComponentProps } from "react-router-dom";
import { Link, withRouter } from "react-router-dom";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { Table, Spin, Button, Input, Modal, Tooltip } from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  PlusSquareOutlined,
  ScheduleOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";
import { AsyncLink } from "components/async_clickables";
import type { APIProjectWithAssignments, APIProject, APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getProjectsWithOpenAssignments,
  getProjectsForTaskType,
  increaseProjectTaskInstances,
  deleteProject,
  pauseProject,
  resumeProject,
  downloadAnnotation,
  getTasks,
  getTaskType,
} from "admin/admin_rest_api";
import Toast from "libs/toast";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import TransferAllTasksModal from "admin/project/transfer_all_tasks_modal";
import * as Utils from "libs/utils";
import messages from "messages";
const { Column } = Table;
const { Search } = Input;
type OwnProps = {
  initialSearchValue?: string;
  taskTypeId?: string;
};
type StateProps = {
  activeUser: APIUser;
};
type Props = OwnProps & StateProps;
type PropsWithRouter = Props & {
  history: RouteComponentProps["history"];
};
type State = {
  isLoading: boolean;
  projects: Array<APIProjectWithAssignments>;
  searchQuery: string;
  isTransferTasksVisible: boolean;
  selectedProject: APIProjectWithAssignments | null | undefined;
  taskTypeName: string | null | undefined;
};
const persistence = new Persistence<Pick<State, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "projectList",
);

class ProjectListView extends React.PureComponent<PropsWithRouter, State> {
  state: State = {
    isLoading: true,
    projects: [],
    searchQuery: "",
    isTransferTasksVisible: false,
    selectedProject: null,
    taskTypeName: "",
  };

  componentDidMount() {
    // @ts-ignore
    this.setState(persistence.load(this.props.history));

    if (this.props.initialSearchValue != null && this.props.initialSearchValue !== "") {
      // Only override the persisted value if the provided initialSearchValue is not empty
      this.setState({
        searchQuery: this.props.initialSearchValue,
      });
    }

    this.fetchData();
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'prevProps' implicitly has an 'any' type... Remove this comment to see the full error message
  componentDidUpdate(prevProps) {
    persistence.persist(this.props.history, this.state);

    if (prevProps.taskTypeId !== this.props.taskTypeId) {
      this.fetchData();
    }
  }

  async fetchData(): Promise<void> {
    let projects;
    let taskTypeName;
    let taskType;

    if (this.props.taskTypeId) {
      [projects, taskType] = await Promise.all([
        getProjectsForTaskType(this.props.taskTypeId),
        getTaskType(this.props.taskTypeId || ""),
      ]);
      taskTypeName = taskType.summary;
    } else {
      projects = await getProjectsWithOpenAssignments();
    }

    this.setState({
      isLoading: false,
      projects: projects.filter((p) => p.owner != null),
      taskTypeName,
    });
  }

  handleSearch = (event: React.SyntheticEvent): void => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      searchQuery: event.target.value,
    });
  };

  deleteProject = (project: APIProjectWithAssignments) => {
    Modal.confirm({
      title: messages["project.delete"],
      onOk: async () => {
        this.setState({
          isLoading: true,
        });

        try {
          await deleteProject(project.id);
          this.setState((prevState) => ({
            projects: prevState.projects.filter((p) => p.id !== project.id),
          }));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          this.setState({
            isLoading: false,
          });
        }
      },
    });
  };

  mergeProjectWithUpdated = (
    oldProject: APIProjectWithAssignments,
    updatedProject: APIProject,
  ): APIProjectWithAssignments => ({ ...oldProject, ...updatedProject });

  pauseResumeProject = async (
    project: APIProjectWithAssignments,
    APICall: (arg0: string) => Promise<APIProject>,
  ) => {
    const updatedProject = await APICall(project.id);
    this.setState((prevState) => ({
      projects: prevState.projects.map((p) =>
        p.id === project.id ? this.mergeProjectWithUpdated(p, updatedProject) : p,
      ),
    }));
  };

  increaseProjectTaskInstances = async (project: APIProjectWithAssignments) => {
    Modal.confirm({
      title: messages["project.increase_instances"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          const updatedProject = await increaseProjectTaskInstances(project.id);
          this.setState((prevState) => ({
            projects: prevState.projects.map((p) => (p.id === project.id ? updatedProject : p)),
          }));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          this.setState({
            isLoading: false,
          });
        }
      },
    });
  };

  showActiveUsersModal = async (project: APIProjectWithAssignments) => {
    this.setState({
      selectedProject: project,
      isTransferTasksVisible: true,
    });
  };

  maybeShowNoFallbackDataInfo = async (projectId: string) => {
    const tasks = await getTasks({
      project: projectId,
    });

    if (tasks.some((task) => task.type.tracingType !== "skeleton")) {
      Toast.info(messages["project.no_fallback_data_included"], {
        timeout: 12000,
      });
    }
  };

  onTaskTransferComplete = () => {
    this.setState({
      isTransferTasksVisible: false,
    });
    this.fetchData();
  };

  renderPlaceholder() {
    return this.state.isLoading ? null : (
      <React.Fragment>
        {"There are no projects. You can "}
        <Link to="/projects/create">add a project</Link>
        {" which can be used to track the progress of tasks."}
      </React.Fragment>
    );
  }

  render() {
    const marginRight = {
      marginRight: 20,
    };
    const typeHint: Array<APIProjectWithAssignments> = [];
    return (
      <div className="container TestProjectListView">
        <div>
          <div className="pull-right">
            {this.props.taskTypeId ? null : (
              <Link to="/projects/create">
                <Button icon={<PlusOutlined />} style={marginRight} type="primary">
                  Add Project
                </Button>
              </Link>
            )}
            <Search
              style={{
                width: 200,
              }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
              value={this.state.searchQuery}
            />
          </div>
          <h3>
            {this.state.taskTypeName
              ? `Projects for task type ${this.state.taskTypeName}`
              : "Projects"}
          </h3>
          <div
            className="clearfix"
            style={{
              margin: "20px 0px",
            }}
          />
          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryAND(
                this.state.projects,
                ["name", "team", "priority", "owner", "numberOfOpenAssignments", "tracingTime"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{
                marginTop: 30,
                marginBottom: 30,
              }}
              locale={{
                emptyText: this.renderPlaceholder(),
              }}
              scroll={{
                x: "max-content",
              }}
              className="large-table"
            >
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy(typeHint, (project) => project.name)}
                width={250}
              />
              <Column
                title="Team"
                dataIndex="teamName"
                key="teamName"
                sorter={Utils.localeCompareBy(typeHint, (project) => project.team)}
                width={300}
              />
              <Column
                title="Priority"
                dataIndex="priority"
                key="priority"
                sorter={Utils.compareBy(typeHint, (project) => project.priority)}
                render={(priority, project: APIProjectWithAssignments) =>
                  `${priority} ${project.paused ? "(paused)" : ""}`
                }
              />
              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy(typeHint, (project) => project.owner.lastName)}
                render={(owner) =>
                  owner.email ? `${owner.lastName}, ${owner.firstName} (${owner.email})` : "-"
                }
              />
              <Column
                title="Open Assignments"
                dataIndex="numberOfOpenAssignments"
                key="numberOfOpenAssignments"
                width={200}
                sorter={Utils.compareBy(typeHint, (project) => project.numberOfOpenAssignments)}
              />
              <Column
                title={
                  <Tooltip title="Total time spent annotating for this project">Time [h]</Tooltip>
                }
                dataIndex="tracingTime"
                key="tracingTime"
                width={200}
                sorter={Utils.compareBy(typeHint, (project) => project.tracingTime)}
                render={(tracingTimeMs) =>
                  Utils.millisecondsToHours(tracingTimeMs).toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })
                }
              />
              <Column
                title="Time Limit"
                dataIndex="expectedTime"
                key="expectedTime"
                width={200}
                sorter={Utils.compareBy(typeHint, (project) => project.expectedTime)}
                render={(expectedTime) => `${expectedTime}m`}
              />
              <Column
                title="Action"
                key="actions"
                fixed="right"
                width={200}
                render={(__, project: APIProjectWithAssignments) => (
                  <span>
                    <Link
                      to={`/annotations/CompoundProject/${project.id}`}
                      title="View all Finished Annotations"
                    >
                      <EyeOutlined />
                      View
                    </Link>
                    <br />
                    <Link to={`/projects/${project.id}/edit`} title="Edit Project">
                      <EditOutlined />
                      Edit
                    </Link>
                    <br />
                    {project.paused ? (
                      <div>
                        <a
                          onClick={_.partial(this.pauseResumeProject, project, resumeProject)}
                          title="Resume Project"
                        >
                          <PlayCircleOutlined />
                          Resume
                        </a>
                        <br />
                      </div>
                    ) : (
                      <div>
                        <a
                          onClick={_.partial(this.pauseResumeProject, project, pauseProject)}
                          title="Pause Tasks"
                        >
                          <PauseCircleOutlined />
                          Pause
                        </a>
                        <br />
                      </div>
                    )}
                    <Link to={`/projects/${project.id}/tasks`} title="View Tasks">
                      <ScheduleOutlined />
                      Tasks
                    </Link>
                    <br />
                    <a
                      onClick={_.partial(this.increaseProjectTaskInstances, project)}
                      title="Increase Task instances"
                    >
                      <PlusSquareOutlined />
                      Increase Instances
                    </a>
                    <br />
                    <AsyncLink
                      href="#"
                      onClick={async () => {
                        this.maybeShowNoFallbackDataInfo(project.id);
                        await downloadAnnotation(project.id, "CompoundProject");
                      }}
                      title="Download all Finished Annotations"
                      icon={<DownloadOutlined key="download-icon" />}
                    >
                      Download
                    </AsyncLink>
                    <br />
                    <a onClick={_.partial(this.showActiveUsersModal, project)}>
                      <TeamOutlined />
                      Show active users
                    </a>
                    <br />
                    {project.owner.email === this.props.activeUser.email ? (
                      <a onClick={_.partial(this.deleteProject, project)}>
                        <DeleteOutlined />
                        Delete
                      </a>
                    ) : null}
                  </span>
                )}
              />
            </Table>
          </Spin>
          {this.state.isTransferTasksVisible ? (
            <TransferAllTasksModal
              project={this.state.selectedProject}
              onCancel={this.onTaskTransferComplete}
              onComplete={this.onTaskTransferComplete}
            />
          ) : null}
        </div>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

const connector = connect(mapStateToProps);
export default connector(withRouter<RouteComponentProps & OwnProps, any>(ProjectListView));
