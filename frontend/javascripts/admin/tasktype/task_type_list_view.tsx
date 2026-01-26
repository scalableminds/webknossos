import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import {
  deleteTaskType as deleteTaskTypeAPI,
  downloadAnnotation,
  getTaskTypes,
} from "admin/rest_api";
import { App, Button, Flex, Input, Space, Spin, Table, Tag } from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedId from "components/formatted_id";
import LinkButton from "components/link_button";
import { handleGenericError } from "libs/error_handling";
import Markdown from "libs/markdown_adapter";
import Persistence from "libs/persistence";
import { filterWithSearchQueryAND, localeCompareBy } from "libs/utils";
import partial from "lodash/partial";
import messages from "messages";
import type React from "react";
import { Fragment, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { APITaskType } from "types/api_types";

const { Column } = Table;
const { Search } = Input;

const persistence = new Persistence<{ searchQuery: string }>(
  {
    searchQuery: PropTypes.string,
  },
  "taskTypeList",
);

function TaskTypeListView() {
  const location = useLocation();
  const initialSearchValue = location.hash.slice(1);

  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [taskTypes, setTaskTypes] = useState<APITaskType[]>([]);
  const { modal } = App.useApp();

  useEffect(() => {
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");

    if (initialSearchValue && initialSearchValue !== "") {
      setSearchQuery(initialSearchValue);
    }
    fetchData();
  }, [initialSearchValue]);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  async function fetchData() {
    setTaskTypes(await getTaskTypes());
    setIsLoading(false);
  }

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function deleteTaskType(taskType: APITaskType) {
    modal.confirm({
      title: messages["taskType.delete"],
      onOk: async () => {
        try {
          setIsLoading(true);
          await deleteTaskTypeAPI(taskType.id);
          setTaskTypes(taskTypes.filter((p) => p.id !== taskType.id));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }

  function renderPlaceholder() {
    return isLoading ? null : (
      <Fragment>
        {"There are no task types. You can "}
        <Link to="/taskTypes/create">add a task type</Link>
        {" in order to configure certain properties, such as a description, for classes of tasks."}
      </Fragment>
    );
  }

  return (
    <div className="container">
      <Flex justify="space-between" align="flex-start">
        <h3>Task Types</h3>
        <Space>
          <Link to="/taskTypes/create">
            <Button icon={<PlusOutlined />} type="primary">
              Add Task Type
            </Button>
          </Link>
          <Search
            style={{
              width: 200,
            }}
            // @ts-expect-error ts-migrate(2322) FIXME: Type '(event: React.ChangeEvent<HTMLInputElement>)... Remove this comment to see the full error message
            onPressEnter={handleSearch}
            onChange={handleSearch}
            value={searchQuery}
          />
        </Space>
      </Flex>

      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={filterWithSearchQueryAND(
            taskTypes,
            ["id", "teamName", "summary", "description", "settings"],
            searchQuery,
          )}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
          }}
          style={{
            marginTop: 30,
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
            title="ID"
            dataIndex="id"
            key="id"
            width={120}
            sorter={localeCompareBy<APITaskType>((taskType) => taskType.id)}
            render={(id) => <FormattedId id={id} />}
          />
          <Column
            title="Team"
            dataIndex="teamName"
            key="team"
            width={230}
            sorter={localeCompareBy<APITaskType>((taskType) => taskType.teamName)}
          />
          <Column
            title="Summary"
            dataIndex="summary"
            key="summary"
            width={230}
            sorter={localeCompareBy<APITaskType>((taskType) => taskType.summary)}
          />
          <Column
            title="Description"
            dataIndex="description"
            key="description"
            sorter={localeCompareBy<APITaskType>((taskType) => taskType.description)}
            render={(description) => (
              <div className="task-type-description short">
                <Markdown>{description}</Markdown>
              </div>
            )}
          />
          <Column
            title="Modes"
            dataIndex="settings"
            key="allowedModes"
            width={200}
            render={(settings: APITaskType["settings"], taskType: APITaskType) => {
              return (
                <Space wrap>
                  {taskType.tracingType === "skeleton" || taskType.tracingType === "hybrid" ? (
                    <Tag color="green" key={`${taskType.id}_skeleton`} variant="outlined">
                      skeleton
                    </Tag>
                  ) : null}
                  {taskType.tracingType === "volume" || taskType.tracingType === "hybrid" ? (
                    <Tag color="orange" key={`${taskType.id}_volume`} variant="outlined">
                      volume
                    </Tag>
                  ) : null}
                  {settings.allowedModes.map((mode) => (
                    <Tag
                      key={mode}
                      color={mode === settings.preferredMode ? "blue" : undefined}
                      variant="outlined"
                    >
                      {mode}
                    </Tag>
                  ))}
                </Space>
              );
            }}
          />
          <Column
            title="Settings"
            dataIndex="settings"
            key="settings"
            render={(settings) => (
              <Space wrap>
                {settings.branchPointsAllowed ? (
                  <Tag key="branchPointsAllowed" variant="outlined">
                    Branchpoints
                  </Tag>
                ) : null}
                {settings.somaClickingAllowed ? (
                  <Tag key="somaClickingAllowed" variant="outlined">
                    Allow Single-node-tree mode (&quot;Soma clicking&quot;)
                  </Tag>
                ) : null}
                {settings.mergerMode ? (
                  <Tag color="purple" key="mergerMode" variant="outlined">
                    Merger Mode
                  </Tag>
                ) : null}
              </Space>
            )}
            width={200}
          />
          <Column
            title="Action"
            key="actions"
            width={140}
            fixed="right"
            render={(__, taskType: APITaskType) => (
              <span>
                <Link
                  to={`/annotations/CompoundTaskType/${taskType.id}`}
                  title="Show Compound Annotation of All Finished Annotations"
                >
                  <EyeOutlined className="icon-margin-right" />
                  View Merged
                </Link>
                <br />
                <Link to={`/taskTypes/${taskType.id}/edit`} title="Edit Task Type">
                  <EditOutlined className="icon-margin-right" />
                  Edit
                </Link>
                <br />
                <Link to={`/taskTypes/${taskType.id}/tasks`} title="View Tasks">
                  <ScheduleOutlined className="icon-margin-right" />
                  Tasks
                </Link>
                <br />
                <Link to={`/taskTypes/${taskType.id}/projects`} title="View Projects">
                  <EyeOutlined className="icon-margin-right" />
                  Projects
                </Link>
                <br />
                <AsyncLink
                  onClick={() => {
                    const includesVolumeData = taskType.tracingType !== "skeleton";
                    return downloadAnnotation(taskType.id, "CompoundTaskType", includesVolumeData);
                  }}
                  title="Download All Finished Annotations"
                  icon={<DownloadOutlined className="icon-margin-right" />}
                >
                  Download
                </AsyncLink>
                <br />
                <LinkButton onClick={partial(deleteTaskType, taskType)} icon={<DeleteOutlined />}>
                  Delete
                </LinkButton>
              </span>
            )}
          />
        </Table>
      </Spin>
    </div>
  );
}

export default TaskTypeListView;
