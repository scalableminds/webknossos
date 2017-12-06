// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { Link } from "react-router-dom";
import { Table, Tag, Icon, Spin, Button, Input, Modal } from "antd";
import TemplateHelpers from "libs/template_helpers";
import Utils from "libs/utils";
import messages from "messages";
import { getActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getProjectsWithOpenAssignments,
  deleteProject,
  pauseProject,
  resumeProject,
} from "admin/admin_rest_api";
import type { APIProjectType, APIUserType } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";

const { Column } = Table;
const { Search } = Input;

type StateProps = {
  activeUser: APIUserType,
};

type State = {
  isLoading: boolean,
  projects: Array<APIProjectType>,
  searchQuery: string,
};

class ProjectListView extends React.PureComponent<StateProps, State> {
  state = {
    isLoading: true,
    projects: [],
    searchQuery: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const projects = await getProjectsWithOpenAssignments();

    this.setState({
      isLoading: false,
      projects: projects.filter(p => p.owner),
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteProject = (project: APIProjectType) => {
    Modal.confirm({
      title: messages["project.delete"],
      onOk: async () => {
        this.setState({
          isLoading: true,
        });

        await deleteProject(project.name);
        this.setState({
          isLoading: false,
          projects: this.state.projects.filter(p => p.id !== project.id),
        });
      },
    });
  };

  pauseResumeProject = async (
    project: APIProjectType,
    APICall: string => Promise<APIProjectType>,
  ) => {
    const updatedProject = await APICall(project.name);
    this.setState({
      projects: this.state.projects.map(p => (p.id === project.id ? updatedProject : p)),
    });
  };

  render() {
    const marginRight = { marginRight: 20 };

    return (
      <div className="container TestProjectListView">
        <div>
          <div className="pull-right">
            <Link to="/projects/create">
              <Button icon="plus" style={marginRight} type="primary">
                Add Project
              </Button>
            </Link>
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
            />
          </div>
          <h3>Projects</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryOR(
                this.state.projects,
                [
                  "name",
                  "team",
                  "priority",
                  "assignmentConfiguration",
                  "owner",
                  "numberOfOpenAssignments",
                ],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy("name")}
              />
              <Column
                title="Team"
                dataIndex="team"
                key="team"
                sorter={Utils.localeCompareBy("team")}
              />
              <Column
                title="Priority"
                dataIndex="priority"
                key="priority"
                sorter={Utils.localeCompareBy((project: APIProjectType) =>
                  project.priority.toString(),
                )}
                render={(priority, project: APIProjectType) =>
                  `${priority} ${project.paused ? "(paused)" : ""}`
                }
              />
              <Column
                title="Location"
                dataIndex="assignmentConfiguration"
                key="assignmentConfiguration"
                sorter={Utils.localeCompareBy(
                  (project: APIProjectType) => project.assignmentConfiguration.location,
                )}
                render={assignmentConfiguration => (
                  <Tag color={TemplateHelpers.stringToColor(assignmentConfiguration.location)}>
                    {assignmentConfiguration.location}
                  </Tag>
                )}
              />
              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy((project: APIProjectType) => project.owner.lastName)}
                render={owner =>
                  owner.email ? `${owner.firstName} ${owner.lastName} (${owner.email})` : "-"
                }
              />
              <Column
                title="Open Assignments"
                dataIndex="numberOfOpenAssignments"
                key="numberOfOpenAssignments"
                sorter={Utils.localeCompareBy((project: APIProjectType) =>
                  project.numberOfOpenAssignments.toString(),
                )}
              />
              <Column
                title="Expected Time"
                dataIndex="expectedTime"
                key="expectedTime"
                sorter={Utils.localeCompareBy((project: APIProjectType) =>
                  project.expectedTime.toString(),
                )}
                render={expectedTime => `${expectedTime}m`}
              />
              <Column
                title="Action"
                key="actions"
                render={(__, project: APIProjectType) => (
                  <span>
                    <Link
                      to={`/annotations/CompoundProject/${project.id}`}
                      title="View all Finished Tracings"
                    >
                      <Icon type="eye-o" />View
                    </Link>
                    <br />
                    <Link to={`/projects/${project.name}/edit`} title="Edit Project">
                      <Icon type="edit" />Edit
                    </Link>
                    <br />
                    {project.paused ? (
                      <div>
                        <a
                          onClick={_.partial(this.pauseResumeProject, project, resumeProject)}
                          title="Resume Project"
                        >
                          <Icon type="play-circle-o" />Resume
                        </a>
                        <br />
                      </div>
                    ) : (
                      <div>
                        <a
                          onClick={_.partial(this.pauseResumeProject, project, pauseProject)}
                          title="Pause Tasks"
                        >
                          <Icon type="pause-circle-o" />Pause
                        </a>
                        <br />
                      </div>
                    )}
                    <Link to={`/projects/${project.id}/tasks`} title="View Tasks">
                      <Icon type="schedule" />Tasks
                    </Link>
                    <br />
                    <a
                      href={`/annotations/CompoundProject/${project.id}/download`}
                      title="Download all Finished Tracings"
                    >
                      <Icon type="download" />Download
                    </a>
                    <br />

                    {project.owner.email === this.props.activeUser.email ? (
                      <a onClick={_.partial(this.deleteProject, project)}>
                        <Icon type="delete" />Delete
                      </a>
                    ) : null}
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

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: getActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(ProjectListView);
