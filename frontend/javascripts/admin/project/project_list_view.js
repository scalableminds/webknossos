// @flow

import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Table, Icon, Spin, Button, Input, Modal } from "antd";
import { connect } from "react-redux";
import * as React from "react";
import _ from "lodash";

import { AsyncLink } from "components/async_clickables";
import type { APIProjectWithAssignments, APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getProjectsWithOpenAssignments,
  getProjectsForTaskType,
  increaseProjectTaskInstances,
  deleteProject,
  pauseProject,
  resumeProject,
  downloadNml,
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

type OwnProps = {|
  initialSearchValue?: string,
  taskTypeId?: string,
|};
type StateProps = {|
  activeUser: APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {|
  ...Props,
  history: RouterHistory,
|};

type State = {
  isLoading: boolean,
  projects: Array<APIProjectWithAssignments>,
  searchQuery: string,
  isTransferTasksVisible: boolean,
  selectedProject: ?APIProjectWithAssignments,
  taskTypeName: ?string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "projectList",
);

class ProjectListView extends React.PureComponent<PropsWithRouter, State> {
  state = {
    isLoading: true,
    projects: [],
    searchQuery: "",
    isTransferTasksVisible: false,
    selectedProject: null,
    taskTypeName: "",
  };

  componentWillMount() {
    this.setState({
      ...persistence.load(this.props.history),
    });
    if (this.props.initialSearchValue != null && this.props.initialSearchValue !== "") {
      // Only override the persisted value if the provided initialSearchValue is not empty
      this.setState({
        searchQuery: this.props.initialSearchValue,
      });
    }
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  componentDidUpdate(preProps) {
    if (preProps.taskTypeId !== this.props.taskTypeId) {
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
      projects: projects.filter(p => p.owner != null),
      taskTypeName,
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteProject = (project: APIProjectWithAssignments) => {
    Modal.confirm({
      title: messages["project.delete"],
      onOk: async () => {
        this.setState({
          isLoading: true,
        });

        try {
          await deleteProject(project.name);
          this.setState(prevState => ({
            projects: prevState.projects.filter(p => p.id !== project.id),
          }));
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
        }
      },
    });
  };

  pauseResumeProject = async (
    project: APIProjectWithAssignments,
    APICall: string => Promise<APIProjectWithAssignments>,
  ) => {
    const updatedProject = await APICall(project.name);
    this.setState(prevState => ({
      projects: prevState.projects.map(p => (p.id === project.id ? updatedProject : p)),
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
          const updatedProject = await increaseProjectTaskInstances(project.name);
          this.setState(prevState => ({
            projects: prevState.projects.map(p => (p.id === project.id ? updatedProject : p)),
          }));
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
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

  maybeShowNoFallbackDataInfo = async (projectName: string) => {
    const tasks = await getTasks({
      project: projectName,
    });
    if (tasks.some(task => task.type.tracingType !== "skeleton")) {
      Toast.info(messages["project.no_fallback_data_included"], {
        timeout: 12000,
      });
    }
  };

  onTaskTransferComplete = () => {
    this.setState({ isTransferTasksVisible: false });
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
    const marginRight = { marginRight: 20 };
    const typeHint: Array<APIProjectWithAssignments> = [];

    return (
      <div className="container TestProjectListView">
        <div>
          <div className="pull-right">
            {this.props.taskTypeId ? null : (
              <Link to="/projects/create">
                <Button icon="plus" style={marginRight} type="primary">
                  Add Project
                </Button>
              </Link>
            )}
            <Search
              style={{ width: 200 }}
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
          <div className="clearfix" style={{ margin: "20px 0px" }} />
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
              style={{ marginTop: 30, marginBotton: 30 }}
              locale={{ emptyText: this.renderPlaceholder() }}
              scroll={{ x: "max-content" }}
              className="large-table"
            >
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy(typeHint, project => project.name)}
                width={250}
              />
              <Column
                title="Team"
                dataIndex="teamName"
                key="teamName"
                sorter={Utils.localeCompareBy(typeHint, project => project.team)}
                width={300}
              />
              <Column
                title="Priority"
                dataIndex="priority"
                key="priority"
                sorter={Utils.compareBy(typeHint, project => project.priority)}
                render={(priority, project: APIProjectWithAssignments) =>
                  `${priority} ${project.paused ? "(paused)" : ""}`
                }
              />
              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy(typeHint, project => project.owner.lastName)}
                render={owner =>
                  owner.email ? `${owner.lastName}, ${owner.firstName} (${owner.email})` : "-"
                }
              />
              <Column
                title="Open Assignments"
                dataIndex="numberOfOpenAssignments"
                key="numberOfOpenAssignments"
                width={200}
                sorter={Utils.compareBy(typeHint, project => project.numberOfOpenAssignments)}
              />
              <Column
                title="Time [h]"
                dataIndex="tracingTime"
                key="tracingTime"
                width={200}
                sorter={Utils.compareBy(typeHint, project => project.tracingTime)}
                render={tracingTimeMs =>
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
                sorter={Utils.compareBy(typeHint, project => project.expectedTime)}
                render={expectedTime => `${expectedTime}m`}
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
                      <Icon type="eye-o" />
                      View
                    </Link>
                    <br />
                    <Link to={`/projects/${project.name}/edit`} title="Edit Project">
                      <Icon type="edit" />
                      Edit
                    </Link>
                    <br />
                    {project.paused ? (
                      <div>
                        <a
                          onClick={_.partial(this.pauseResumeProject, project, resumeProject)}
                          title="Resume Project"
                        >
                          <Icon type="play-circle-o" />
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
                          <Icon type="pause-circle-o" />
                          Pause
                        </a>
                        <br />
                      </div>
                    )}
                    <Link to={`/projects/${project.name}/tasks`} title="View Tasks">
                      <Icon type="schedule" />
                      Tasks
                    </Link>
                    <br />
                    <a
                      onClick={_.partial(this.increaseProjectTaskInstances, project)}
                      title="Increase Task instances"
                    >
                      <Icon type="plus-square-o" />
                      Increase Instances
                    </a>
                    <br />
                    <AsyncLink
                      href="#"
                      onClick={async () => {
                        this.maybeShowNoFallbackDataInfo(project.name);
                        await downloadNml(project.id, "CompoundProject");
                      }}
                      title="Download all Finished Annotations"
                    >
                      <Icon type="download" />
                      Download
                    </AsyncLink>
                    <br />
                    <a onClick={_.partial(this.showActiveUsersModal, project)}>
                      <Icon type="team" />
                      Show active users
                    </a>
                    <br />
                    {project.owner.email === this.props.activeUser.email ? (
                      <a onClick={_.partial(this.deleteProject, project)}>
                        <Icon type="delete" />
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

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(ProjectListView));
