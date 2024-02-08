import { Link } from "react-router-dom";
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
import type { APIProjectWithStatus, APIProject, APIUser, APIUserBase } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getProjectsWithStatus,
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
import FormattedDate from "components/formatted_date";
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

type State = {
  isLoading: boolean;
  projects: Array<APIProjectWithStatus>;
  searchQuery: string;
  isTransferTasksVisible: boolean;
  selectedProject: APIProjectWithStatus | null | undefined;
  taskTypeName: string | null | undefined;
};
const persistence = new Persistence<Pick<State, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "projectList",
);

class ProjectListView extends React.PureComponent<Props, State> {
  state: State = {
    isLoading: true,
    projects: [],
    searchQuery: "",
    isTransferTasksVisible: false,
    selectedProject: null,
    taskTypeName: "",
  };

  componentDidMount() {
    this.setState(persistence.load() as { searchQuery: string });

    if (this.props.initialSearchValue != null && this.props.initialSearchValue !== "") {
      // Only override the persisted value if the provided initialSearchValue is not empty
      this.setState({
        searchQuery: this.props.initialSearchValue,
      });
    }

    this.fetchData();
  }

  componentDidUpdate(prevProps: Props) {
    persistence.persist(this.state);

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
      projects = await getProjectsWithStatus();
    }

    this.setState({
      isLoading: false,
      projects: projects.filter((p) => p.owner != null),
      taskTypeName,
    });
  }

  handleSearch = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  deleteProject = (project: APIProjectWithStatus) => {
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
    oldProject: APIProjectWithStatus,
    updatedProject: APIProject,
  ): APIProjectWithStatus => ({ ...oldProject, ...updatedProject });

  pauseResumeProject = async (
    project: APIProjectWithStatus,
    APICall: (arg0: string) => Promise<APIProject>,
  ) => {
    const updatedProject = await APICall(project.id);
    this.setState((prevState) => ({
      projects: prevState.projects.map((p) =>
        p.id === project.id ? this.mergeProjectWithUpdated(p, updatedProject) : p,
      ),
    }));
  };

  increaseProjectTaskInstances = async (project: APIProjectWithStatus) => {
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

  showActiveUsersModal = async (project: APIProjectWithStatus) => {
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
        {"There are no projects yet or no projects matching your filters. "}
        <Link to="/projects/create">Add a new project</Link>
        {" to distribute and track the progress of annotation tasks or adjust your filters."}
      </React.Fragment>
    );
  }

  render() {
    const greaterThanZeroFilters = [
      {
        text: "0",
        value: "0",
      },
      {
        text: ">0",
        value: ">0",
      },
    ];

    const typeHint: Array<APIProjectWithStatus> = [];
    const filteredProjects = Utils.filterWithSearchQueryAND(
      this.state.projects,
      ["name", "team", "priority", "owner", "pendingInstances", "tracingTime"],
      this.state.searchQuery,
    );

    return (
      <div className="container TestProjectListView">
        <div>
          <div className="pull-right">
            {this.props.taskTypeId ? null : (
              <Link to="/projects/create">
                <Button icon={<PlusOutlined />} style={{ marginRight: 20 }} type="primary">
                  Add Project
                </Button>
              </Link>
            )}
            <Search
              style={{
                width: 200,
              }}
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
              dataSource={filteredProjects}
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
                title="Pending Task Instances"
                dataIndex="pendingInstances"
                key="pendingInstances"
                sorter={Utils.compareBy(typeHint, (project) => project.pendingInstances)}
                filters={greaterThanZeroFilters}
                onFilter={(value, project: APIProjectWithStatus) => {
                  if (value === "0") {
                    return project.tracingTime === 0;
                  }
                  return project.tracingTime > 0;
                }}
              />
              <Column
                title={
                  <Tooltip title="Total annotating time spent on this project">Time [h]</Tooltip>
                }
                dataIndex="tracingTime"
                key="tracingTime"
                sorter={Utils.compareBy(typeHint, (project) => project.tracingTime)}
                render={(tracingTimeMs) =>
                  Utils.millisecondsToHours(tracingTimeMs).toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })
                }
                filters={greaterThanZeroFilters}
                onFilter={(value, project: APIProjectWithStatus) => {
                  if (value === "0") {
                    return project.tracingTime === 0;
                  }
                  return project.tracingTime > 0;
                }}
              />
              <Column
                title="Team"
                dataIndex="teamName"
                key="teamName"
                sorter={Utils.localeCompareBy(typeHint, (project) => project.team)}
                filters={_.uniqBy(
                  filteredProjects.map((project) => ({
                    text: project.teamName,
                    value: project.team,
                  })),
                  "text",
                )}
                onFilter={(value, project: APIProjectWithStatus) => value === project.team}
                filterMultiple
              />
              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy(typeHint, (project) => project.owner.lastName)}
                render={(owner: APIUserBase) => (
                  <>
                    <div>{owner.email ? `${owner.lastName}, ${owner.firstName}` : "-"}</div>
                    <div>{owner.email ? `(${owner.email})` : "-"}</div>
                  </>
                )}
                filters={_.uniqBy(
                  filteredProjects.map((project) => ({
                    text: `${project.owner.firstName} ${project.owner.lastName}`,
                    value: project.owner.id,
                  })),
                  "text",
                )}
                onFilter={(value, project: APIProjectWithStatus) => value === project.owner.id}
                filterMultiple
              />
              <Column
                title="Creation Date"
                dataIndex="created"
                key="created"
                sorter={Utils.compareBy(typeHint, (project) => project.created)}
                render={(created) => <FormattedDate timestamp={created} />}
                defaultSortOrder="descend"
              />
              <Column
                title="Priority"
                dataIndex="priority"
                key="priority"
                sorter={Utils.compareBy(typeHint, (project) => project.priority)}
                render={(priority, project: APIProjectWithStatus) =>
                  `${priority} ${project.paused ? "(paused)" : ""}`
                }
                filters={[
                  {
                    text: "Paused",
                    value: "paused",
                  },
                ]}
                onFilter={(_value, project: APIProjectWithStatus) => project.paused}
              />
              <Column
                title="Time Limit"
                dataIndex="expectedTime"
                key="expectedTime"
                sorter={Utils.compareBy(typeHint, (project) => project.expectedTime)}
                render={(expectedTime) => `${expectedTime}m`}
              />
              <Column
                title="Action"
                key="actions"
                fixed="right"
                width={200}
                render={(__, project: APIProjectWithStatus) => (
                  <span>
                    <Link
                      to={`/annotations/CompoundProject/${project.id}`}
                      title="View all Finished Annotations"
                    >
                      <EyeOutlined className="icon-margin-right" />
                      View
                    </Link>
                    <br />
                    <Link to={`/projects/${project.id}/edit`} title="Edit Project">
                      <EditOutlined className="icon-margin-right" />
                      Edit
                    </Link>
                    <br />
                    {project.paused ? (
                      <div>
                        <a
                          onClick={_.partial(this.pauseResumeProject, project, resumeProject)}
                          title="Resume Project"
                        >
                          <PlayCircleOutlined className="icon-margin-right" />
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
                          <PauseCircleOutlined className="icon-margin-right" />
                          Pause
                        </a>
                        <br />
                      </div>
                    )}
                    <Link to={`/projects/${project.id}/tasks`} title="View Tasks">
                      <ScheduleOutlined className="icon-margin-right" />
                      Tasks
                    </Link>
                    <br />
                    <a
                      onClick={_.partial(this.increaseProjectTaskInstances, project)}
                      title="Increase Task instances"
                    >
                      <PlusSquareOutlined className="icon-margin-right" />
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
                      icon={<DownloadOutlined key="download-icon" className="icon-margin-right" />}
                    >
                      Download
                    </AsyncLink>
                    <br />
                    <a onClick={_.partial(this.showActiveUsersModal, project)}>
                      <TeamOutlined className="icon-margin-right" />
                      Show active users
                    </a>
                    <br />
                    {project.owner.email === this.props.activeUser.email ? (
                      <a onClick={_.partial(this.deleteProject, project)}>
                        <DeleteOutlined className="icon-margin-right" />
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
export default connector(ProjectListView);
