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
import { PropTypes } from "@scalableminds/prop-types";
import {
  deleteProject as deleteProjectAPI,
  downloadAnnotation,
  getProjectsForTaskType,
  getProjectsWithStatus,
  getTaskType,
  increaseProjectTaskInstances as increaseProjectTaskInstancesAPI,
  pauseProject,
  resumeProject,
} from "admin/admin_rest_api";
import { getTasks } from "admin/api/tasks";
import TransferAllTasksModal from "admin/project/transfer_all_tasks_modal";
import { App, Button, Input, Spin, Table, Tooltip } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import { useEffectOnlyOnce } from "libs/react_hooks";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import type { WebknossosState } from "oxalis/store";
import React, { useEffect, useState } from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import {
  type APIProject,
  type APIProjectWithStatus,
  type APIUser,
  type APIUserBase,
  TracingTypeEnum,
} from "types/api_types";

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

const persistence = new Persistence<{ searchQuery: string }>(
  {
    searchQuery: PropTypes.string,
  },
  "projectList",
);

function ProjectListView({ initialSearchValue, taskTypeId, activeUser }: Props) {
  const { modal } = App.useApp();

  const [isLoading, setIsLoading] = useState(true);
  const [projects, setProjects] = useState<APIProjectWithStatus[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isTransferTasksVisible, setIsTransferTasksVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<APIProjectWithStatus | undefined>(
    undefined,
  );
  const [taskTypeName, setTaskTypeName] = useState<string | undefined>("");

  useEffectOnlyOnce(() => {
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
    if (initialSearchValue != null && initialSearchValue !== "") {
      // Only override the persisted value if the provided initialSearchValue is not empty
      setSearchQuery(initialSearchValue);
    }
    fetchData(taskTypeId);
  });

  useEffect(() => {
    fetchData(taskTypeId);
  }, [taskTypeId]);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  useEffect(() => {
    fetchData(taskTypeId);
  }, [taskTypeId]);

  async function fetchData(taskTypeId?: string): Promise<void> {
    let projects;
    let taskTypeName;
    let taskType;

    if (taskTypeId) {
      [projects, taskType] = await Promise.all([
        getProjectsForTaskType(taskTypeId),
        getTaskType(taskTypeId || ""),
      ]);
      taskTypeName = taskType.summary;
    } else {
      projects = await getProjectsWithStatus();
    }

    setIsLoading(false);
    setProjects(projects.filter((p) => p.owner != null));
    setTaskTypeName(taskTypeName);
  }

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function deleteProject(project: APIProjectWithStatus) {
    modal.confirm({
      title: messages["project.delete"],
      onOk: async () => {
        setIsLoading(true);

        try {
          await deleteProjectAPI(project.id);
          setProjects(projects.filter((p) => p.id !== project.id));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }

  function mergeProjectWithUpdated(
    oldProject: APIProjectWithStatus,
    updatedProject: APIProject,
  ): APIProjectWithStatus {
    return { ...oldProject, ...updatedProject };
  }

  async function pauseResumeProject(
    project: APIProjectWithStatus,
    APICall: (arg0: string) => Promise<APIProject>,
  ) {
    const updatedProject = await APICall(project.id);
    setProjects(
      projects.map((p) => (p.id === project.id ? mergeProjectWithUpdated(p, updatedProject) : p)),
    );
  }

  async function increaseProjectTaskInstances(project: APIProjectWithStatus) {
    modal.confirm({
      title: messages["project.increase_instances"],
      onOk: async () => {
        try {
          setIsLoading(true);
          const updatedProject = await increaseProjectTaskInstancesAPI(project.id);
          setProjects(projects.map((p) => (p.id === project.id ? updatedProject : p)));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }

  function showActiveUsersModal(project: APIProjectWithStatus) {
    setSelectedProject(project);
    setIsTransferTasksVisible(true);
  }

  async function maybeShowNoFallbackDataInfo(projectId: string) {
    const tasks = await getTasks({
      project: projectId,
    });

    if (tasks.some((task) => task.type.tracingType !== TracingTypeEnum.skeleton)) {
      Toast.info(messages["project.no_fallback_data_included"], {
        timeout: 12000,
      });
    }
  }

  function onTaskTransferComplete() {
    setIsTransferTasksVisible(false);
    fetchData(taskTypeId);
  }

  function renderPlaceholder() {
    return isLoading ? null : (
      <React.Fragment>
        {"There are no projects yet or no projects matching your filters. "}
        <Link to="/projects/create">Add a new project</Link>
        {" to distribute and track the progress of annotation tasks or adjust your filters."}
      </React.Fragment>
    );
  }

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

  const filteredProjects = Utils.filterWithSearchQueryAND(
    projects,
    ["name", "team", "priority", "owner", "pendingInstances", "tracingTime"],

    searchQuery,
  );

  return (
    <div className="container TestProjectListView">
      <div>
        <div className="pull-right">
          {taskTypeId ? null : (
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
            onChange={handleSearch}
            value={searchQuery}
          />
        </div>
        <h3>{taskTypeName ? `Projects for task type ${taskTypeName}` : "Projects"}</h3>
        <div
          className="clearfix"
          style={{
            margin: "20px 0px",
          }}
        />
        <Spin spinning={isLoading} size="large">
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
              emptyText: renderPlaceholder(),
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
              sorter={Utils.localeCompareBy<APIProjectWithStatus>((project) => project.name)}
              width={250}
            />
            <Column
              title="Pending Task Instances"
              dataIndex="pendingInstances"
              key="pendingInstances"
              sorter={Utils.compareBy<APIProjectWithStatus>((project) => project.pendingInstances)}
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
              sorter={Utils.compareBy<APIProjectWithStatus>((project) => project.tracingTime)}
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
              sorter={Utils.localeCompareBy<APIProjectWithStatus>((project) => project.team)}
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
              sorter={Utils.localeCompareBy<APIProjectWithStatus>(
                (project) => project.owner.lastName,
              )}
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
              sorter={Utils.compareBy<APIProjectWithStatus>((project) => project.created)}
              render={(created) => <FormattedDate timestamp={created} />}
              defaultSortOrder="descend"
            />
            <Column
              title="Priority"
              dataIndex="priority"
              key="priority"
              sorter={Utils.compareBy<APIProjectWithStatus>((project) => project.priority)}
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
              sorter={Utils.compareBy<APIProjectWithStatus>((project) => project.expectedTime)}
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
                        onClick={_.partial(pauseResumeProject, project, resumeProject)}
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
                        onClick={_.partial(pauseResumeProject, project, pauseProject)}
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
                    onClick={_.partial(increaseProjectTaskInstances, project)}
                    title="Increase Task instances"
                  >
                    <PlusSquareOutlined className="icon-margin-right" />
                    Increase Instances
                  </a>
                  <br />
                  <AsyncLink
                    href="#"
                    onClick={async () => {
                      maybeShowNoFallbackDataInfo(project.id);
                      await downloadAnnotation(project.id, "CompoundProject");
                    }}
                    title="Download all Finished Annotations"
                    icon={<DownloadOutlined key="download-icon" className="icon-margin-right" />}
                  >
                    Download
                  </AsyncLink>
                  <br />
                  <a onClick={_.partial(showActiveUsersModal, project)}>
                    <TeamOutlined className="icon-margin-right" />
                    Show active users
                  </a>
                  <br />
                  {project.owner.email === activeUser.email ? (
                    <a onClick={_.partial(deleteProject, project)}>
                      <DeleteOutlined className="icon-margin-right" />
                      Delete
                    </a>
                  ) : null}
                </span>
              )}
            />
          </Table>
        </Spin>
        {isTransferTasksVisible ? (
          <TransferAllTasksModal
            project={selectedProject}
            onCancel={onTaskTransferComplete}
            onComplete={onTaskTransferComplete}
          />
        ) : null}
      </div>
    </div>
  );
}

const mapStateToProps = (state: WebknossosState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

const connector = connect(mapStateToProps);
export default connector(ProjectListView);
