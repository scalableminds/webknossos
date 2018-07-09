// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import React from "react";
import { Link, withRouter } from "react-router-dom";
import { Table, Tag, Spin, Button, Input, Modal, Icon, Card } from "antd";
import Utils from "libs/utils";
import Clipboard from "clipboard-js";
import Toast from "libs/toast";
import messages from "messages";
import TaskSearchForm from "admin/task/task_search_form";
import { deleteTask, getTasks } from "admin/admin_rest_api";
import TemplateHelpers from "libs/template_helpers";
import FormatUtils from "libs/format_utils";
import TaskAnnotationView from "admin/task/task_annotation_view";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import type { APITaskType, APITaskTypeType } from "admin/api_flow_types";
import type { QueryObjectType, TaskFormFieldValuesType } from "admin/task/task_search_form";
import type { RouterHistory } from "react-router-dom";
import { handleGenericError } from "libs/error_handling";

const { Column } = Table;
const { Search, TextArea } = Input;

type Props = {
  initialFieldValues?: TaskFormFieldValuesType,
  history: RouterHistory,
};

type State = {
  isLoading: boolean,
  tasks: Array<APITaskType>,
  searchQuery: string,
  isAnonymousTaskLinkModalVisible: boolean,
};

const typeHint: Array<APITaskType> = [];

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

  async fetchData(queryObject: QueryObjectType) {
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

  deleteTask = (task: APITaskType) => {
    Modal.confirm({
      title: messages["task.delete"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          await deleteTask(task.id);
          this.setState({
            tasks: this.state.tasks.filter(t => t.id !== task.id),
          });
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
        }
      },
    });
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
            value={this.state.searchQuery}
          />
        </div>
        <h3>Tasks</h3>
        <div className="clearfix" style={{ margin: "20px 0px" }} />

        <Card title="Search for Tasks">
          <TaskSearchForm
            onChange={queryObject => this.fetchData(queryObject)}
            initialFieldValues={this.props.initialFieldValues}
            isLoading={this.state.isLoading}
          />
        </Card>

        <Spin spinning={this.state.isLoading} size="large">
          <Table
            dataSource={Utils.filterWithSearchQueryAND(
              this.state.tasks,
              [
                "team",
                "projectName",
                "id",
                "dataSet",
                "created",
                "type",
                task => task.neededExperience.domain,
              ],
              this.state.searchQuery,
            )}
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
              sorter={Utils.localeCompareBy(typeHint, "id")}
              className="monospace-id"
            />
            <Column
              title="Project"
              dataIndex="projectName"
              key="projectName"
              width={130}
              sorter={Utils.localeCompareBy(typeHint, "projectName")}
              render={(projectName: string) => (
                <a href={`/projects#${projectName}`}>{projectName}</a>
              )}
            />
            <Column
              title="Type"
              dataIndex="type"
              key="type"
              width={100}
              sorter={Utils.localeCompareBy(typeHint, task => task.type.summary)}
              render={(taskType: APITaskTypeType) => (
                <a href={`/taskTypes#${taskType.id}`}>{taskType.summary}</a>
              )}
            />
            <Column
              title="Dataset"
              dataIndex="dataSet"
              key="dataSet"
              width={130}
              sorter={Utils.localeCompareBy(typeHint, "dataSet")}
            />
            <Column
              title="Edit Position / Bounding Box"
              dataIndex="editPosition"
              key="editPosition"
              width={130}
              render={(__, task: APITaskType) => (
                <div className="nowrap">
                  {TemplateHelpers.formatTuple(task.editPosition)} <br />
                  <span>{TemplateHelpers.formatTuple(task.boundingBoxVec6)}</span>
                </div>
              )}
            />
            <Column
              title="Experience"
              dataIndex="neededExperience"
              key="neededExperience"
              sorter={Utils.localeCompareBy(typeHint, task => task.neededExperience.domain)}
              width={200}
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
              width={150}
              sorter={Utils.localeCompareBy(typeHint, "created")}
            />
            <Column
              title="Stats"
              dataIndex="status"
              key="status"
              width={80}
              render={(status, task: APITaskType) => (
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
                    {FormatUtils.formatSeconds((task.tracingTime || 0) / 1000)}
                  </span>
                </div>
              )}
            />
            <Column
              title="Action"
              key="actions"
              width={130}
              render={(__, task: APITaskType) => (
                <span>
                  {task.status.finished > 0 ? (
                    <a
                      href={`/annotations/CompoundTask/${task.id}`}
                      title="View all Finished Tracings"
                    >
                      <Icon type="eye-o" />View
                    </a>
                  ) : null}
                  <br />
                  <a href={`/tasks/${task.id}/edit`} title="Edit Task">
                    <Icon type="edit" />Edit
                  </a>
                  <br />
                  {task.status.finished > 0 ? (
                    <a
                      href={`/api/annotations/CompoundTask/${task.id}/download`}
                      title="Download all Finished Tracings"
                    >
                      <Icon type="download" />Download
                    </a>
                  ) : null}
                  <br />
                  <a href="#" onClick={_.partial(this.deleteTask, task)}>
                    <Icon type="delete" />Delete
                  </a>
                </span>
              )}
            />
          </Table>
          {this.getAnonymousTaskLinkModal()}
        </Spin>
      </div>
    );
  }
}

export default withRouter(TaskListView);
