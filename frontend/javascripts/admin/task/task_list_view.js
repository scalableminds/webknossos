// @flow
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { PropTypes } from "@scalableminds/prop-types";
import { Table, Tag, Spin, Button, Input, Modal, Icon, Card } from "antd";
import Clipboard from "clipboard-js";
import React from "react";
import _ from "lodash";

import { AsyncLink } from "components/async_clickables";
import type { APITask, APITaskType } from "admin/api_flow_types";
import { deleteTask, getTasks, downloadNml } from "admin/admin_rest_api";
import { formatTuple, formatSeconds } from "libs/format_utils";
import { handleGenericError } from "libs/error_handling";
import FormattedDate from "components/formatted_date";
import Persistence from "libs/persistence";
import TaskAnnotationView from "admin/task/task_annotation_view";
import { downloadTasksAsCSV } from "admin/task/task_create_form_view";
import TaskSearchForm, {
  type QueryObject,
  type TaskFormFieldValues,
} from "admin/task/task_search_form";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import FixedExpandableTable from "components/fixed_expandable_table";

const { Column } = Table;
const { Search, TextArea } = Input;

type Props = {|
  initialFieldValues?: TaskFormFieldValues,
  history: RouterHistory,
|};

type State = {
  isLoading: boolean,
  tasks: Array<APITask>,
  searchQuery: string,
  isAnonymousTaskLinkModalVisible: boolean,
};

const typeHint: Array<APITask> = [];

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "taskList",
);

class TaskListView extends React.PureComponent<Props, State> {
  state = {
    isLoading: false,
    tasks: [],
    searchQuery: "",
    isAnonymousTaskLinkModalVisible: Utils.hasUrlParam("showAnonymousLinks"),
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  async fetchData(queryObject: QueryObject) {
    if (!_.isEmpty(queryObject)) {
      this.setState({ isLoading: true });

      try {
        const tasks = await getTasks(queryObject);
        this.setState({
          tasks,
        });
      } catch (error) {
        handleGenericError(error);
      } finally {
        this.setState({ isLoading: false });
      }
    } else {
      this.setState({ tasks: [] });
    }
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteTask = (task: APITask) => {
    Modal.confirm({
      title: messages["task.delete"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          await deleteTask(task.id);
          this.setState(prevState => ({
            tasks: prevState.tasks.filter(t => t.id !== task.id),
          }));
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
        }
      },
    });
  };

  getFilteredTasks = () => {
    const { searchQuery, tasks } = this.state;
    return Utils.filterWithSearchQueryAND(
      tasks,
      [
        "team",
        "projectName",
        "id",
        "dataSet",
        "created",
        "type",
        task => task.neededExperience.domain,
      ],
      searchQuery,
    );
  };

  downloadSettingsFromAllTasks = async (queryObject: QueryObject) => {
    await this.fetchData(queryObject);
    const filteredTasks = this.getFilteredTasks();
    if (filteredTasks.length > 0) {
      downloadTasksAsCSV(filteredTasks);
    } else {
      Toast.warning(messages["task.no_tasks_to_download"]);
    }
  };

  getAnonymousTaskLinkModal() {
    const anonymousTaskId = Utils.getUrlParamValue("showAnonymousLinks");
    if (!this.state.isAnonymousTaskLinkModalVisible) {
      return null;
    }
    const tasksString = this.state.tasks
      .filter(t => t.id === anonymousTaskId)
      .map(t => t.directLinks)
      .join("\n");
    return (
      <Modal
        title={`Anonymous Task Links for Task ${anonymousTaskId}`}
        visible={this.state.isAnonymousTaskLinkModalVisible}
        onOk={() => {
          Clipboard.copy(tasksString).then(() => Toast.success("Links copied to clipboard"));
          this.setState({ isAnonymousTaskLinkModalVisible: false });
        }}
        onCancel={() => this.setState({ isAnonymousTaskLinkModalVisible: false })}
      >
        <TextArea autosize={{ minRows: 2, maxRows: 10 }} defaultValue={tasksString} />
      </Modal>
    );
  }

  render() {
    const marginRight = { marginRight: 20 };
    const { searchQuery, isLoading } = this.state;

    return (
      <div className="container">
        <div className="pull-right">
          <Link to="/tasks/create">
            <Button icon="plus" style={marginRight} type="primary">
              Add Task
            </Button>
          </Link>
          <Search
            style={{ width: 200 }}
            onPressEnter={this.handleSearch}
            onChange={this.handleSearch}
            value={searchQuery}
          />
        </div>
        <h3>Tasks</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />

        <Card title="Search for Tasks">
          <TaskSearchForm
            onChange={queryObject => this.fetchData(queryObject)}
            initialFieldValues={this.props.initialFieldValues}
            isLoading={isLoading}
            onDownloadAllTasks={this.downloadSettingsFromAllTasks}
          />
        </Card>

        <Spin spinning={isLoading} size="large">
          <FixedExpandableTable
            dataSource={this.getFilteredTasks()}
            rowKey="id"
            pagination={{
              defaultPageSize: 50,
            }}
            style={{ marginTop: 30, marginBotton: 30 }}
            expandedRowRender={task => <TaskAnnotationView task={task} />}
          >
            <Column
              title="ID"
              dataIndex="id"
              key="id"
              sorter={Utils.localeCompareBy(typeHint, task => task.id)}
              className="monospace-id"
              width={100}
            />
            <Column
              title="Project"
              dataIndex="projectName"
              key="projectName"
              width={130}
              sorter={Utils.localeCompareBy(typeHint, task => task.projectName)}
              render={(projectName: string) => (
                <a href={`/projects#${projectName}`}>{projectName}</a>
              )}
            />
            <Column
              title="Type"
              dataIndex="type"
              key="type"
              width={200}
              sorter={Utils.localeCompareBy(typeHint, task => task.type.summary)}
              render={(taskType: APITaskType) => (
                <a href={`/taskTypes#${taskType.id}`}>{taskType.summary}</a>
              )}
            />
            <Column
              title="Dataset"
              dataIndex="dataSet"
              key="dataSet"
              sorter={Utils.localeCompareBy(typeHint, task => task.dataSet)}
            />
            <Column
              title="Edit Position / Bounding Box"
              dataIndex="editPosition"
              key="editPosition"
              width={150}
              render={(__, task: APITask) => (
                <div className="nowrap">
                  {formatTuple(task.editPosition)} <br />
                  <span>{formatTuple(task.boundingBoxVec6)}</span>
                </div>
              )}
            />
            <Column
              title="Experience"
              dataIndex="neededExperience"
              key="neededExperience"
              sorter={Utils.localeCompareBy(typeHint, task => task.neededExperience.domain)}
              width={250}
              render={neededExperience =>
                neededExperience.domain !== "" || neededExperience.value > 0 ? (
                  <Tag>
                    {neededExperience.domain} : {neededExperience.value}
                  </Tag>
                ) : null
              }
            />
            <Column
              title="Creation Date"
              dataIndex="created"
              key="created"
              width={200}
              sorter={Utils.compareBy(typeHint, task => task.created)}
              render={created => <FormattedDate timestamp={created} />}
            />
            <Column
              title="Stats"
              dataIndex="status"
              key="status"
              width={120}
              render={(status, task: APITask) => (
                <div className="nowrap">
                  <span title="Open Instances">
                    <Icon type="play-circle-o" />
                    {status.open}
                  </span>
                  <br />
                  <span title="Active Instances">
                    <Icon type="fork" />
                    {status.active}
                  </span>
                  <br />
                  <span title="Finished Instances">
                    <Icon type="check-circle-o" />
                    {status.finished}
                  </span>
                  <br />
                  <span title="Tracing Time">
                    <Icon type="clock-circle-o" />
                    {formatSeconds((task.tracingTime || 0) / 1000)}
                  </span>
                </div>
              )}
            />
            <Column
              title="Action"
              key="actions"
              width={170}
              fixed="right"
              render={(__, task: APITask) => (
                <span>
                  {task.status.finished > 0 ? (
                    <a
                      href={`/annotations/CompoundTask/${task.id}`}
                      title="View all Finished Tracings"
                    >
                      <Icon type="eye-o" />
                      View
                    </a>
                  ) : null}
                  <br />
                  <a href={`/tasks/${task.id}/edit`} title="Edit Task">
                    <Icon type="edit" />
                    Edit
                  </a>
                  <br />
                  {task.status.finished > 0 ? (
                    <AsyncLink
                      href="#"
                      onClick={() => {
                        const includesVolumeData = task.type.tracingType !== "skeleton";
                        return downloadNml(task.id, "CompoundTask", includesVolumeData);
                      }}
                      title="Download all Finished Tracings"
                    >
                      <Icon type="download" />
                      Download
                    </AsyncLink>
                  ) : null}
                  <br />
                  <a href="#" onClick={_.partial(this.deleteTask, task)}>
                    <Icon type="delete" />
                    Delete
                  </a>
                </span>
              )}
            />
          </FixedExpandableTable>
          {this.getAnonymousTaskLinkModal()}
        </Spin>
      </div>
    );
  }
}

export default withRouter(TaskListView);
