import { Link } from "react-router-dom";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { Table, Tag, Spin, Button, Input, App } from "antd";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
import * as React from "react";
import _ from "lodash";
import { AsyncLink } from "components/async_clickables";
import type { APITaskType } from "types/api_flow_types";
import {
  getTaskTypes,
  deleteTaskType as deleteTaskTypeAPI,
  downloadAnnotation,
} from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import LinkButton from "components/link_button";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import messages from "messages";
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
import { useEffect, useState } from "react";

const { Column } = Table;
const { Search } = Input;

type Props = {
  initialSearchValue?: string;
};

const persistence = new Persistence<{ searchQuery: string }>(
  {
    searchQuery: PropTypes.string,
  },
  "taskTypeList",
);

function TaskTypeListView({ initialSearchValue }: Props) {
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
      <React.Fragment>
        {"There are no task types. You can "}
        <Link to="/taskTypes/create">add a task type</Link>
        {" in order to configure certain properties, such as a description, for classes of tasks."}
      </React.Fragment>
    );
  }

  const marginRight = {
    marginRight: 20,
  };
  return (
    <div className="container">
      <div className="pull-right">
        <Link to="/taskTypes/create">
          <Button icon={<PlusOutlined />} style={marginRight} type="primary">
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
      </div>
      <h3>Task Types</h3>
      <div
        className="clearfix"
        style={{
          margin: "20px 0px",
        }}
      />

      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={Utils.filterWithSearchQueryAND(
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
            title="ID"
            dataIndex="id"
            key="id"
            width={120}
            sorter={Utils.localeCompareBy<APITaskType>((taskType) => taskType.id)}
            className="monospace-id"
          />
          <Column
            title="Team"
            dataIndex="teamName"
            key="team"
            width={230}
            sorter={Utils.localeCompareBy<APITaskType>((taskType) => taskType.teamName)}
          />
          <Column
            title="Summary"
            dataIndex="summary"
            key="summary"
            width={230}
            sorter={Utils.localeCompareBy<APITaskType>((taskType) => taskType.summary)}
          />
          <Column
            title="Description"
            dataIndex="description"
            key="description"
            sorter={Utils.localeCompareBy<APITaskType>((taskType) => taskType.description)}
            render={(description) => (
              <div className="task-type-description short">
                <Markdown
                  source={description}
                  options={{
                    html: false,
                    breaks: true,
                    linkify: true,
                  }}
                />
              </div>
            )}
          />
          <Column
            title="Modes"
            dataIndex="settings"
            key="allowedModes"
            width={200}
            render={(settings: APITaskType["settings"], taskType: APITaskType) =>
              [
                taskType.tracingType === "skeleton" || taskType.tracingType === "hybrid" ? (
                  <Tag color="green" key={`${taskType.id}_skeleton`}>
                    skeleton
                  </Tag>
                ) : null,
                taskType.tracingType === "volume" || taskType.tracingType === "hybrid" ? (
                  <Tag color="orange" key={`${taskType.id}_volume`}>
                    volume
                  </Tag>
                ) : null,
              ].concat(
                settings.allowedModes.map((mode) => (
                  <Tag key={mode} color={mode === settings.preferredMode ? "blue" : undefined}>
                    {mode}
                  </Tag>
                )),
              )
            }
          />
          <Column
            title="Settings"
            dataIndex="settings"
            key="settings"
            render={(settings) => {
              const elements = [];
              if (settings.branchPointsAllowed)
                elements.push(<Tag key="branchPointsAllowed">Branchpoints</Tag>);
              if (settings.somaClickingAllowed)
                elements.push(
                  <Tag key="somaClickingAllowed">
                    Allow Single-node-tree mode (&quot;Soma clicking&quot;)
                  </Tag>,
                );
              if (settings.mergerMode)
                elements.push(
                  <Tag color="purple" key="mergerMode">
                    Merger Mode
                  </Tag>,
                );
              return elements;
            }}
            width={200}
          />
          <Column
            title="Action"
            key="actions"
            width={140}
            fixed="right"
            render={(__, taskType: APITaskType) => (
              <span>
                <Link to={`/annotations/CompoundTaskType/${taskType.id}`} title="View">
                  <EyeOutlined className="icon-margin-right" />
                  View
                </Link>
                <br />
                <Link to={`/taskTypes/${taskType.id}/edit`} title="Edit taskType">
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
                  href="#"
                  onClick={() => {
                    const includesVolumeData = taskType.tracingType !== "skeleton";
                    return downloadAnnotation(taskType.id, "CompoundTaskType", includesVolumeData);
                  }}
                  title="Download all Finished Annotations"
                  icon={<DownloadOutlined className="icon-margin-right" />}
                >
                  Download
                </AsyncLink>
                <br />
                <LinkButton onClick={_.partial(deleteTaskType, taskType)}>
                  <DeleteOutlined className="icon-margin-right" />
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
