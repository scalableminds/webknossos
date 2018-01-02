// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { Link } from "react-router-dom";
import { Table, Tag, Icon, Spin, Button, Input, Modal } from "antd";
import Markdown from "react-remarkable";
import Utils from "libs/utils";
import messages from "messages";
import { getTaskTypes, deleteTaskType } from "admin/admin_rest_api";
import type { APITaskTypeType } from "admin/api_flow_types";

const { Column } = Table;
const { Search } = Input;

type State = {
  isLoading: boolean,
  tasktypes: Array<APITaskTypeType>,
  searchQuery: string,
};

class TaskTypeListView extends React.PureComponent<{}, State> {
  state = {
    isLoading: true,
    tasktypes: [],
    searchQuery: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const tasktypes = await getTaskTypes();

    this.setState({
      isLoading: false,
      tasktypes,
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteTaskType = (taskType: APITaskTypeType) => {
    Modal.confirm({
      title: messages["taskType.delete"],
      onOk: async () => {
        this.setState({
          isLoading: true,
        });

        await deleteTaskType(taskType.id);
        this.setState({
          isLoading: false,
          tasktypes: this.state.tasktypes.filter(p => p.id !== taskType.id),
        });
      },
    });
  };

  render() {
    const marginRight = { marginRight: 20 };

    return (
      <div className="container">
        <div style={{ marginTag: 20 }}>
          <div className="pull-right">
            <Link to="/taskTypes/create">
              <Button icon="plus" style={marginRight} type="primary">
                Add TaskType
              </Button>
            </Link>
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
            />
          </div>
          <h3>Task Types</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryOR(
                this.state.tasktypes,
                ["id", "team", "summary", "description", "settings"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Column
                title="ID"
                dataIndex="id"
                key="id"
                width={100}
                sorter={Utils.localeCompareBy("id")}
                className="monospace-id"
              />
              <Column
                title="Team"
                dataIndex="team"
                key="team"
                width={130}
                sorter={Utils.localeCompareBy("team")}
              />
              <Column
                title="Summary"
                dataIndex="summary"
                key="summary"
                width={130}
                sorter={Utils.localeCompareBy("summary")}
              />
              <Column
                title="Description"
                dataIndex="description"
                key="description"
                sorter={Utils.localeCompareBy("description")}
                render={description => (
                  <div className="task-type-description">
                    <Markdown
                      source={description}
                      options={{ html: false, breaks: true, linkify: true }}
                    />
                  </div>
                )}
                width={300}
              />
              <Column
                title="Modes"
                dataIndex="settings"
                key="allowedModes"
                width={100}
                render={settings =>
                  settings.allowedModes.map(mode => (
                    <Tag key={mode} color={mode === settings.preferredMode ? "blue" : null}>
                      {mode}
                    </Tag>
                  ))
                }
              />
              <Column
                title="Settings"
                dataIndex="settings"
                key="settings"
                render={settings => {
                  const elements = [];
                  if (settings.branchPointsAllowed)
                    elements.push(<Tag key="branchPointsAllowed">Branchpoints</Tag>);
                  if (settings.somaClickingAllowed)
                    elements.push(<Tag key="somaClickingAllowed">Soma clicking</Tag>);
                  if (settings.advancedOptionsAllowed)
                    elements.push(<Tag key="advancedOptionsAllowed">Advanced Options</Tag>);
                  return elements;
                }}
                width={100}
              />
              <Column
                title="Action"
                key="actions"
                width={140}
                render={(__, taskType: APITaskTypeType) => (
                  <span>
                    <Link to={`/annotations/CompoundTaskType/${taskType.id}`} title="View">
                      <Icon type="eye-o" />View
                    </Link>
                    <br />
                    <Link to={`/taskTypes/${taskType.id}/edit`} title="Edit taskType">
                      <Icon type="edit" />Edit
                    </Link>
                    <br />
                    <Link to={`/taskTypes/${taskType.id}/tasks`} title="View Tasks">
                      <Icon type="schedule" />Tasks
                    </Link>
                    <br />
                    <a
                      href={`/annotations/CompoundTaskType/${taskType.id}/download`}
                      title="Download all Finished Tracings"
                    >
                      <Icon type="download" />Download
                    </a>
                    <br />
                    <a href="#" onClick={_.partial(this.deleteTaskType, taskType)}>
                      <Icon type="delete" />Delete
                    </a>
                  </span>
                )}
              />
            </Table>
          </Spin>
        </div>
      </div>
    );
  }
}

export default TaskTypeListView;
