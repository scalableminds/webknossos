import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ScheduleOutlined,
} from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { deleteTaskType, downloadAnnotation, getTaskTypes } from "admin/admin_rest_api";
import { Button, Input, Modal, Spin, Table, Tag } from "antd";
import { AsyncLink } from "components/async_clickables";
import LinkButton from "components/link_button";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import * as React from "react";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import Markdown from "react-remarkable";
import { Link } from "react-router-dom";
import type { APITaskType } from "types/api_flow_types";
const { Column } = Table;
const { Search } = Input;
type Props = {
  initialSearchValue?: string;
};
type State = {
  isLoading: boolean;
  tasktypes: APITaskType[];
  searchQuery: string;
};
const persistence = new Persistence<Pick<State, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "taskTypeList",
);

class TaskTypeListView extends React.PureComponent<Props, State> {
  state: State = {
    isLoading: true,
    tasktypes: [],
    searchQuery: "",
  };

  componentDidMount() {
    // @ts-ignore
    this.setState(persistence.load());

    if (this.props.initialSearchValue && this.props.initialSearchValue !== "") {
      this.setState({
        searchQuery: this.props.initialSearchValue,
      });
    }

    this.fetchData();
  }

  componentDidUpdate() {
    persistence.persist(this.state);
  }

  async fetchData(): Promise<void> {
    const tasktypes = await getTaskTypes();
    this.setState({
      isLoading: false,
      tasktypes,
    });
  }

  handleSearch = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  deleteTaskType = (taskType: APITaskType) => {
    Modal.confirm({
      title: messages["taskType.delete"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          await deleteTaskType(taskType.id);
          this.setState((prevState) => ({
            tasktypes: prevState.tasktypes.filter((p) => p.id !== taskType.id),
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

  renderPlaceholder() {
    return this.state.isLoading ? null : (
      <React.Fragment>
        {"There are no task types. You can "}
        <Link to="/taskTypes/create">add a task type</Link>
        {" in order to configure certain properties, such as a description, for classes of tasks."}
      </React.Fragment>
    );
  }

  render() {
    const marginRight = {
      marginRight: 20,
    };
    const typeHint: Array<APITaskType> = [];
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
            onPressEnter={this.handleSearch}
            onChange={this.handleSearch}
            value={this.state.searchQuery}
          />
        </div>
        <h3>Task Types</h3>
        <div
          className="clearfix"
          style={{
            margin: "20px 0px",
          }}
        />

        <Spin spinning={this.state.isLoading} size="large">
          <Table
            dataSource={Utils.filterWithSearchQueryAND(
              this.state.tasktypes,
              ["id", "teamName", "summary", "description", "settings"],
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
              title="ID"
              dataIndex="id"
              key="id"
              width={120}
              sorter={Utils.localeCompareBy(typeHint, (taskType) => taskType.id)}
              className="monospace-id"
            />
            <Column
              title="Team"
              dataIndex="teamName"
              key="team"
              width={230}
              sorter={Utils.localeCompareBy(typeHint, (taskType) => taskType.teamName)}
            />
            <Column
              title="Summary"
              dataIndex="summary"
              key="summary"
              width={230}
              sorter={Utils.localeCompareBy(typeHint, (taskType) => taskType.summary)}
            />
            <Column
              title="Description"
              dataIndex="description"
              key="description"
              sorter={Utils.localeCompareBy(typeHint, (taskType) => taskType.description)}
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
                      return downloadAnnotation(
                        taskType.id,
                        "CompoundTaskType",
                        includesVolumeData,
                      );
                    }}
                    title="Download all Finished Annotations"
                    icon={<DownloadOutlined className="icon-margin-right" />}
                  >
                    Download
                  </AsyncLink>
                  <br />
                  <LinkButton onClick={_.partial(this.deleteTaskType, taskType)}>
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
}

export default TaskTypeListView;
