import { Link } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Tag, Spin, Button, Input, Modal, Card, Alert, App, type TableProps } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  ForkOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import type React from "react";
import { useEffect, useState } from "react";
import _ from "lodash";
import features from "features";
import { AsyncLink } from "components/async_clickables";
import type { APITask, APITaskType, TaskStatus } from "types/api_flow_types";
import { downloadAnnotation as downloadAnnotationAPI } from "admin/admin_rest_api";
import {
  deleteTask as deleteTaskAPI,
  getTasks,
  assignTaskToUser as assignTaskToUserAPI,
} from "admin/api/tasks";
import { formatTuple, formatSeconds } from "libs/format_utils";
import { handleGenericError } from "libs/error_handling";
import FormattedDate from "components/formatted_date";
import Persistence from "libs/persistence";
import TaskAnnotationView from "admin/task/task_annotation_view";
import LinkButton from "components/link_button";
import { downloadTasksAsCSV } from "admin/task/task_create_form_view";
import type { QueryObject, TaskFormFieldValues } from "admin/task/task_search_form";
import TaskSearchForm from "admin/task/task_search_form";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import FixedExpandableTable from "components/fixed_expandable_table";
import UserSelectionComponent from "admin/user/user_selection_component";

const { Search, TextArea } = Input;

type Props = {
  initialFieldValues?: TaskFormFieldValues;
};

const persistence = new Persistence<{ searchQuery: string }>(
  {
    searchQuery: PropTypes.string,
  },
  "taskList",
);

function TaskListView({ initialFieldValues }: Props) {
  const { modal } = App.useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [tasks, setTasks] = useState<APITask[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserIdForAssignment, setSelectedUserIdForAssignment] = useState<string | null>(
    null,
  );
  const [isAnonymousTaskLinkModalOpen, setIsAnonymousTaskLinkModalOpen] = useState(
    Utils.hasUrlParam("showAnonymousLinks"),
  );

  useEffect(() => {
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
  }, []);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  async function fetchData(queryObject: QueryObject) {
    if (!_.isEmpty(queryObject)) {
      setIsLoading(true);

      try {
        const tasks = await getTasks(queryObject);
        setTasks(tasks);
      } catch (error) {
        handleGenericError(error as Error);
      } finally {
        setIsLoading(false);
      }
    } else {
      setTasks([]);
    }
  }

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function deleteTask(task: APITask) {
    modal.confirm({
      title: messages["task.delete"],
      onOk: async () => {
        try {
          setIsLoading(true);
          await deleteTaskAPI(task.id);
          setTasks(tasks.filter((t) => t.id !== task.id));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }

  function assignTaskToUser(task: APITask) {
    modal.confirm({
      title: "Manual Task Assignment",
      icon: <UserAddOutlined />,
      width: 500,
      content: (
        <>
          <div>Please, select a user to manually assign this task to:</div>
          <div style={{ marginTop: 10, marginBottom: 25 }}>
            <UserSelectionComponent
              handleSelection={(value) => setSelectedUserIdForAssignment(value)}
            />
          </div>
          <Alert
            message="Note, manual assignments will bypass the automated task distribution system and its checks for user experience, access rights and other eligibility criteria."
            type="info"
          />
        </>
      ),
      onOk: async () => {
        const userId = selectedUserIdForAssignment;
        if (userId != null) {
          try {
            const updatedTask = await assignTaskToUserAPI(task.id, userId);

            setTasks([...tasks.filter((t) => t.id !== task.id), updatedTask]);

            Toast.success("A user was successfully assigned to the task.");
          } catch (error) {
            handleGenericError(error as Error);
          } finally {
            setSelectedUserIdForAssignment(null);
          }
        }
      },
    });
  }

  function getFilteredTasks() {
    return Utils.filterWithSearchQueryAND(
      tasks,
      [
        "team",
        "projectName",
        "id",
        "datasetName",
        "created",
        "type",
        (task) => task.neededExperience.domain,
      ],
      searchQuery,
    );
  }

  async function downloadSettingsFromAllTasks(queryObject: QueryObject) {
    await fetchData(queryObject);
    const filteredTasks = getFilteredTasks();

    if (filteredTasks.length > 0) {
      downloadTasksAsCSV(filteredTasks);
    } else {
      Toast.warning(messages["task.no_tasks_to_download"]);
    }
  }

  function getAnonymousTaskLinkModal() {
    const anonymousTaskId = Utils.getUrlParamValue("showAnonymousLinks");

    if (!isAnonymousTaskLinkModalOpen) {
      return null;
    }

    const tasksString = tasks
      .filter((t) => t.id === anonymousTaskId)
      .map((t) => t.directLinks)
      .join("\n");
    return (
      <Modal
        title={`Anonymous Task Links for Task ${anonymousTaskId}`}
        open={isAnonymousTaskLinkModalOpen}
        onOk={() => {
          navigator.clipboard
            .writeText(tasksString)
            .then(() => Toast.success("Links copied to clipboard"));
          setIsAnonymousTaskLinkModalOpen(false);
        }}
        onCancel={() => setIsAnonymousTaskLinkModalOpen(false)}
      >
        <TextArea
          autoSize={{
            minRows: 2,
            maxRows: 10,
          }}
          defaultValue={tasksString}
        />
      </Modal>
    );
  }

  function renderPlaceholder() {
    return (
      <>
        <p>
          There are no tasks in the current search. Select search criteria above or create new tasks
          by clicking on the <strong>Add Task</strong> button.
        </p>
        <p>
          To learn more about the task system in WEBKNOSSOS,{" "}
          <a
            href="https://docs.webknossos.org/webknossos/tasks_projects/index.html"
            rel="noopener noreferrer"
            target="_blank"
          >
            check out the documentation
          </a>
          .
        </p>
      </>
    );
  }

  const marginRight = {
    marginRight: 20,
  };

  const columns: TableProps["columns"] = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      sorter: Utils.localeCompareBy<APITask>((task) => task.id),
      className: "monospace-id",
      width: 100,
    },
    {
      title: "Project",
      dataIndex: "projectName",
      key: "projectName",
      width: 130,
      sorter: Utils.localeCompareBy<APITask>((task) => task.projectName),
      render: (projectName: string) => <a href={`/projects#${projectName}`}>{projectName}</a>,
    },
    {
      title: "Type",
      dataIndex: "type",
      key: "type",
      width: 200,
      sorter: Utils.localeCompareBy<APITask>((task) => task.type.summary),
      render: (taskType: APITaskType) => (
        <a href={`/taskTypes#${taskType.id}`}>{taskType.summary}</a>
      ),
    },
    {
      title: "Dataset",
      dataIndex: "datasetName",
      key: "datasetName",
      sorter: Utils.localeCompareBy<APITask>((task) => task.datasetName),
    },
    {
      title: "Stats",
      dataIndex: "status",
      key: "status",
      render: (status: APITask["status"], task: APITask) => (
        <div className="nowrap">
          <span title="Pending Instances">
            <PlayCircleOutlined className="icon-margin-right" />
            {status.pending}
          </span>
          <br />
          <span title="Active Instances">
            <ForkOutlined className="icon-margin-right" />
            {status.active}
          </span>
          <br />
          <span title="Finished Instances">
            <CheckCircleOutlined className="icon-margin-right" />
            {status.finished}
          </span>
          <br />
          <span title="Annotation Time">
            <ClockCircleOutlined className="icon-margin-right" />
            {formatSeconds((task.tracingTime || 0) / 1000)}
          </span>
        </div>
      ),
      filters: [
        {
          text: "Has Pending Instances",
          value: "pending",
        },
        {
          text: "Has Active Instances",
          value: "active",
        },
        {
          text: "Has Finished Instances",
          value: "finished",
        },
      ],
      onFilter: (key: any, task: APITask) => task.status[key as unknown as keyof TaskStatus] > 0,
    },
    {
      title: "Edit Position / Bounding Box",
      dataIndex: "editPosition",
      key: "editPosition",
      width: 150,
      render: (_, task: APITask) => (
        <div className="nowrap">
          {formatTuple(task.editPosition)} <br />
          <span>{formatTuple(task.boundingBoxVec6)}</span>
        </div>
      ),
    },
    {
      title: "Experience",
      dataIndex: "neededExperience",
      key: "neededExperience",
      sorter: Utils.localeCompareBy<APITask>((task) => task.neededExperience.domain),
      width: 250,
      render: (neededExperience: APITask["neededExperience"]) =>
        neededExperience.domain !== "" || neededExperience.value > 0 ? (
          <Tag>
            {neededExperience.domain} : {neededExperience.value}
          </Tag>
        ) : null,
    },
    {
      title: "Creation Date",
      dataIndex: "created",
      key: "created",
      width: 200,
      sorter: Utils.compareBy<APITask>((task) => task.created),
      render: (created: APITask["created"]) => <FormattedDate timestamp={created} />,
      defaultSortOrder: "descend",
    },
    {
      title: "Action",
      key: "actions",
      width: 170,
      fixed: "right",
      render: (_unused, task: APITask) => (
        <>
          {task.status.finished > 0 ? (
            <div>
              <a
                href={`/annotations/CompoundTask/${task.id}`}
                title="View all Finished Annotations"
              >
                <EyeOutlined className="icon-margin-right" />
                View
              </a>
            </div>
          ) : null}
          <div>
            <a href={`/tasks/${task.id}/edit`} title="Edit Task">
              ,
              <EditOutlined className="icon-margin-right" />
              Edit
            </a>
          </div>
          {task.status.pending > 0 ? (
            <div>
              <LinkButton onClick={_.partial(assignTaskToUser, task)}>
                <UserAddOutlined className="icon-margin-right" />
                Manually Assign to User
              </LinkButton>
            </div>
          ) : null}
          {task.status.finished > 0 ? (
            <div>
              <AsyncLink
                href="#"
                onClick={() => {
                  const includesVolumeData = task.type.tracingType !== "skeleton";
                  return downloadAnnotationAPI(task.id, "CompoundTask", includesVolumeData);
                }}
                title="Download all Finished Annotations"
                icon={<DownloadOutlined className="icon-margin-right" />}
              >
                Download
              </AsyncLink>
            </div>
          ) : null}
          <div>
            <LinkButton onClick={_.partial(deleteTask, task)}>
              <DeleteOutlined className="icon-margin-right" />
              Delete
            </LinkButton>
          </div>
        </>
      ),
    },
  ];

  return (
    <div className="container">
      <div className="pull-right">
        <Link to="/tasks/create">
          <Button icon={<PlusOutlined />} style={marginRight} type="primary">
            Add Task
          </Button>
        </Link>
        <Search
          style={{
            width: 200,
          }}
          onChange={handleSearch}
          value={searchQuery}
        />
      </div>
      <h3
        style={{
          display: "inline-block",
          verticalAlign: "top",
        }}
      >
        Tasks
      </h3>
      {features().isWkorgInstance ? (
        <>
          <a
            href="https://webknossos.org/services/annotations"
            className="crosslink-box"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background:
                'url("/assets/images/vx/manual-annotations-horizontal.png") center center / 110%',
              height: "73px",
              padding: "0px",
              width: "800px",
              overflow: "hidden",
              display: "inline-block",
              marginLeft: "100px",
              marginBottom: 0,
              opacity: "0.9",
              marginTop: 0,
            }}
          >
            <div
              style={{
                padding: "10px 170px",
                background:
                  "linear-gradient(181deg, #1414147a, rgb(59 59 59 / 45%), rgba(20, 19, 31, 0.84))",
              }}
            >
              <h4
                style={{
                  color: "white",
                  textAlign: "center",
                }}
              >
                Need more workforce for annotating your dataset?
                <br />
                Have a look at our annotation services.
              </h4>
            </div>
          </a>
          <div
            className="clearfix"
            style={{
              margin: "20px 0px",
            }}
          />
        </>
      ) : null}

      <Card title="Search for Tasks">
        <TaskSearchForm
          onChange={(queryObject) => fetchData(queryObject)}
          initialFieldValues={initialFieldValues}
          isLoading={isLoading}
          onDownloadAllTasks={downloadSettingsFromAllTasks}
        />
      </Card>

      <Spin spinning={isLoading} size="large">
        <FixedExpandableTable
          dataSource={getFilteredTasks()}
          rowKey="id"
          columns={columns}
          pagination={{
            defaultPageSize: 50,
          }}
          style={{
            marginTop: 30,
            marginBottom: 30,
          }}
          expandable={{
            expandedRowRender: (task) => <TaskAnnotationView task={task} />,
          }}
          locale={{
            emptyText: renderPlaceholder(),
          }}
        />

        {getAnonymousTaskLinkModal()}
      </Spin>
    </div>
  );
}

export default TaskListView;
