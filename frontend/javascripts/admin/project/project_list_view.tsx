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
import { useQueryClient } from "@tanstack/react-query";
import AdminPage from "admin/admin_page";
import { getTasks } from "admin/api/tasks";
import TransferAllTasksModal from "admin/project/transfer_all_tasks_modal";
import {
  deleteProject as deleteProjectAPI,
  downloadAnnotation,
  getProjectsForTaskType,
  getProjectsWithStatus,
  getTaskType,
  increaseProjectTaskInstances as increaseProjectTaskInstancesAPI,
  pauseProject,
  resumeProject,
} from "admin/rest_api";
import { App, Button, Input, Spin, Table, Tooltip } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import {
  compareBy,
  filterWithSearchQueryAND,
  localeCompareBy,
  millisecondsToHours,
  scrollToTop,
} from "libs/utils";
import partial from "lodash-es/partial";
import uniqBy from "lodash-es/uniqBy";
import messages from "messages";
import React, { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  type APIProject,
  type APIProjectWithStatus,
  type APIUserBase,
  TracingTypeEnum,
} from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";

const { Column } = Table;
const { Search } = Input;

const persistence = new Persistence<{ searchQuery: string }>(
  {
    searchQuery: PropTypes.string,
  },
  "projectList",
);

function ProjectListView() {
  const { taskTypeId } = useParams();

  const { modal } = App.useApp();
  const location = useLocation();
  const initialSearchValue = location.hash.slice(1);

  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const queryClient = useQueryClient();

  const {
    data: projects = [],
    isFetching: isLoadingProjects,
    refetch,
  } = useQueryWithErrorHandling({
    queryKey: ["projectsWithStatus", taskTypeId],
    queryFn: async () => {
      const projects = taskTypeId
        ? await getProjectsForTaskType(taskTypeId)
        : await getProjectsWithStatus();
      return projects.filter((p) => p.owner != null);
    },
    refetchOnWindowFocus: false,
  });

  const { data: taskType } = useQueryWithErrorHandling({
    queryKey: ["taskType", taskTypeId],
    queryFn: () => getTaskType(taskTypeId!),
    enabled: taskTypeId != null,
    refetchOnWindowFocus: false,
  });
  const taskTypeName = taskType?.summary;

  const [searchQuery, setSearchQuery] = useState(() =>
    initialSearchValue !== "" ? initialSearchValue : persistence.load().searchQuery || "",
  );
  const [isLoadingMutation, setIsLoadingMutation] = useState(false);
  const [isTransferTasksVisible, setIsTransferTasksVisible] = useState(false);
  const [selectedProject, setSelectedProject] = useState<APIProjectWithStatus | undefined>(
    undefined,
  );

  const isLoading = isLoadingProjects || isLoadingMutation;

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    const newSearchQuery = event.target.value;
    setSearchQuery(newSearchQuery);
    persistence.persist({ searchQuery: newSearchQuery });
  }

  function deleteProject(project: APIProjectWithStatus) {
    modal.confirm({
      title: messages["project.delete"],
      onOk: async () => {
        setIsLoadingMutation(true);
        try {
          await deleteProjectAPI(project.id);
          queryClient.setQueryData(
            ["projectsWithStatus", taskTypeId],
            (currentProjects: APIProjectWithStatus[]) =>
              currentProjects.filter((p) => p.id !== project.id),
          );
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoadingMutation(false);
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
    queryClient.setQueryData(
      ["projectsWithStatus", taskTypeId],
      (currentProjects: APIProjectWithStatus[]) =>
        currentProjects.map((p) =>
          p.id === project.id ? mergeProjectWithUpdated(p, updatedProject) : p,
        ),
    );
  }

  async function increaseProjectTaskInstances(project: APIProjectWithStatus) {
    modal.confirm({
      title: messages["project.increase_instances"],
      onOk: async () => {
        try {
          setIsLoadingMutation(true);
          const updatedProject = await increaseProjectTaskInstancesAPI(project.id);
          queryClient.setQueryData(
            ["projectsWithStatus", taskTypeId],
            (currentProjects: APIProjectWithStatus[]) =>
              currentProjects.map((p) => (p.id === project.id ? updatedProject : p)),
          );
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoadingMutation(false);
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
    refetch();
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

  const filteredProjects = filterWithSearchQueryAND(
    projects,
    ["name", "team", "priority", "owner", "pendingInstances", "tracingTime"],

    searchQuery,
  );

  return (
    <AdminPage
      title={taskTypeName ? `Projects for task type ${taskTypeName}` : "Projects"}
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/projects.html"
      description="Create projects, monitor progress, and manage annotation workload."
      actions={
        taskTypeId ? null : (
          <Link to="/projects/create">
            <Button icon={<PlusOutlined />} type="primary">
              Add Project
            </Button>
          </Link>
        )
      }
      search={<Search allowClear onChange={handleSearch} value={searchQuery} />}
    >
      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={filteredProjects}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
            onChange: scrollToTop,
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
            sorter={localeCompareBy<APIProjectWithStatus>((project) => project.name)}
            width={250}
          />
          <Column
            title="Pending Task Instances"
            dataIndex="pendingInstances"
            align="right"
            key="pendingInstances"
            sorter={compareBy<APIProjectWithStatus>((project) => project.pendingInstances)}
            filters={greaterThanZeroFilters}
            onFilter={(value, project: APIProjectWithStatus) => {
              if (value === "0") {
                return project.pendingInstances === 0;
              }
              return project.pendingInstances > 0;
            }}
          />
          <Column
            title={<Tooltip title="Total annotating time spent on this project">Time [h]</Tooltip>}
            dataIndex="tracingTime"
            align="right"
            key="tracingTime"
            sorter={compareBy<APIProjectWithStatus>((project) => project.tracingTime)}
            render={(tracingTimeMs) =>
              millisecondsToHours(tracingTimeMs).toLocaleString(undefined, {
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
            sorter={localeCompareBy<APIProjectWithStatus>((project) => project.team)}
            filters={uniqBy(
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
            sorter={localeCompareBy<APIProjectWithStatus>((project) => project.owner.lastName)}
            render={(owner: APIUserBase) => (
              <>
                <div>{owner.email ? `${owner.lastName}, ${owner.firstName}` : "-"}</div>
                <div>{owner.email ? `(${owner.email})` : "-"}</div>
              </>
            )}
            filters={uniqBy(
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
            sorter={compareBy<APIProjectWithStatus>((project) => project.created)}
            render={(created) => <FormattedDate timestamp={created} />}
            defaultSortOrder="descend"
          />
          <Column
            title="Priority"
            dataIndex="priority"
            key="priority"
            align="right"
            sorter={compareBy<APIProjectWithStatus>((project) => project.priority)}
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
            align="right"
            key="expectedTime"
            sorter={compareBy<APIProjectWithStatus>((project) => project.expectedTime)}
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
                  title="Show Compound Annotation of All Finished Annotations"
                >
                  <EyeOutlined className="icon-margin-right" />
                  View Merged
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
                      onClick={partial(pauseResumeProject, project, resumeProject)}
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
                      onClick={partial(pauseResumeProject, project, pauseProject)}
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
                  onClick={partial(increaseProjectTaskInstances, project)}
                  title="Increase Task Instances"
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
                  title="Download All Finished Annotations"
                  icon={<DownloadOutlined key="download-icon" className="icon-margin-right" />}
                >
                  Download
                </AsyncLink>
                <br />
                <a onClick={partial(showActiveUsersModal, project)}>
                  <TeamOutlined className="icon-margin-right" />
                  Show active users
                </a>
                <br />
                {project.owner.email === activeUser.email ? (
                  <a onClick={partial(deleteProject, project)}>
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
    </AdminPage>
  );
}

export default ProjectListView;
