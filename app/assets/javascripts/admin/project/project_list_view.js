// @flow

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { Link, withRouter } from "react-router-dom";
import { Table, Icon, Spin, Button, Input, Modal } from "antd";
import Utils from "libs/utils";
import messages from "messages";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getProjectsWithOpenAssignments,
  increaseProjectTaskInstances,
  deleteProject,
  pauseProject,
  resumeProject,
} from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import type { APIProjectType, APIUserType } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import type { RouterHistory } from "react-router-dom";
import { handleGenericError } from "libs/error_handling";

const { Column } = Table;
const { Search } = Input;

type StateProps = {
  activeUser: APIUserType,
};

type Props = {
  history: RouterHistory,
  initialSearchValue?: string,
} & StateProps;

type State = {
  isLoading: boolean,
  projects: Array<APIProjectType>,
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "projectList",
);

class ProjectListView extends React.PureComponent<Props, State> {
  state = {
    isLoading: true,
    projects: [],
    searchQuery: "",
  };

  componentWillMount() {
    this.setState({
      ...persistence.load(this.props.history),
    });
    if (this.props.initialSearchValue != null && this.props.initialSearchValue !== "") {
      // Only override the persisted value if the provided initialSearchValue is not empty
      this.setState({
        searchQuery: this.props.initialSearchValue,
      });
    }
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  async fetchData(): Promise<void> {
    const projects = await getProjectsWithOpenAssignments();

    this.setState({
      isLoading: false,
      projects: projects.filter(p => p.owner != null),
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

        try {
          await deleteProject(project.name);
          this.setState({
            projects: this.state.projects.filter(p => p.id !== project.id),
          });
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
        }
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

  increaseProjectTaskInstances = async (project: APIProjectType) => {
    Modal.confirm({
      title: messages["project.increase_instances"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          const updatedProject = await increaseProjectTaskInstances(project.name);
          this.setState({
            projects: this.state.projects.map(p => (p.id === project.id ? updatedProject : p)),
          });
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
        }
      },
    });
  };

  render() {
    const marginRight = { marginRight: 20 };
    const typeHint: Array<APIProjectType> = [];

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
              value={this.state.searchQuery}
            />
          </div>
          <h3>Projects</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryOR(
                this.state.projects,
                ["name", "team", "priority", "owner", "numberOfOpenAssignments"],
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
                sorter={Utils.localeCompareBy(typeHint, "name")}
              />
              <Column
                title="Team"
                dataIndex="teamName"
                key="teamName"
                sorter={Utils.localeCompareBy(typeHint, "team")}
              />
              <Column
                title="Priority"
                dataIndex="priority"
                key="priority"
                sorter={Utils.compareBy(typeHint, project => project.priority)}
                render={(priority, project: APIProjectType) =>
                  `${priority} ${project.paused ? "(paused)" : ""}`
                }
              />
              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy(typeHint, project => project.owner.lastName)}
                render={owner =>
                  owner.email ? `${owner.firstName} ${owner.lastName} (${owner.email})` : "-"
                }
              />
              <Column
                title="Open Assignments"
                dataIndex="numberOfOpenAssignments"
                key="numberOfOpenAssignments"
                sorter={Utils.compareBy(typeHint, project => project.numberOfOpenAssignments)}
              />
              <Column
                title="Expected Time"
                dataIndex="expectedTime"
                key="expectedTime"
                sorter={Utils.compareBy(typeHint, project => project.expectedTime)}
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
                    <Link to={`/projects/${project.name}/tasks`} title="View Tasks">
                      <Icon type="schedule" />Tasks
                    </Link>
                    <br />
                    <a
                      onClick={_.partial(this.increaseProjectTaskInstances, project)}
                      title="Increase Task instances"
                    >
                      <Icon type="plus-square-o" />Increase Instances
                    </a>
                    <br />
                    <a
                      href={`/api/annotations/CompoundProject/${project.id}/download`}
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
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(withRouter(ProjectListView));
