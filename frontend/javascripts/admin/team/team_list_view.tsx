import { DeleteOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { deleteTeam, getEditableTeams, getEditableUsers } from "admin/admin_rest_api";
import CreateTeamModal from "admin/team/create_team_modal_view";
import { Alert, Button, Input, Modal, Spin, Table, Tag } from "antd";
import LinkButton from "components/link_button";
import { handleGenericError } from "libs/error_handling";
import { stringToColor } from "libs/format_utils";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import _ from "lodash";
import messages from "messages";
import * as React from "react";
import type { APITeam, APITeamMembership, APIUser } from "types/api_flow_types";
import { EmptyObject } from "types/globals";
import EditTeamModalView from "./edit_team_modal_view";
const { Column } = Table;
const { Search } = Input;
const typeHint: APITeam[] = [];

type Props = EmptyObject;
type State = {
  isLoading: boolean;
  teams: APITeam[];
  users: APIUser[];
  searchQuery: string;
  isTeamCreationModalVisible: boolean;
  isTeamEditModalVisible: boolean;
  selectedTeam: APITeam | null;
};

export function renderTeamRolesAndPermissionsForUser(user: APIUser) {
  //used by user list page
  const tags = [
    ...(user.isOrganizationOwner ? [["Organization Owner", "cyan"]] : []),
    ...(user.isAdmin
      ? [["Admin - Access to all Teams", "red"]]
      : [
          ...(user.isDatasetManager ? [["Dataset Manager - Edit all Datasets", "geekblue"]] : []),
          ...user.teams.map((team) => {
            const roleName = team.isTeamManager ? "Team Manager" : "Member";
            return [`${team.name}: ${roleName}`, stringToColor(roleName)];
          }),
        ]),
  ];

  return tags.map(([text, color]) => (
    <Tag key={`${text}_${user.id}`} color={color} style={{ marginBottom: 4 }}>
      {text}
    </Tag>
  ));
}

export function filterTeamMembersOf(team: APITeam, user: APIUser): boolean {
  return (
    user.teams.some((userTeam: APITeamMembership) => userTeam.id === team.id) ||
    (user.isAdmin && user.isActive)
  );
}

export function renderUsersForTeam(
  team: APITeam,
  allUsers: APIUser[] | null,
  renderAdditionalContent = (_teamMember: APIUser, _team: APITeam) => {},
) {
  if (allUsers === null) return;
  const teamMembers = allUsers.filter((user) => filterTeamMembersOf(team, user));
  if (teamMembers.length === 0) return messages["team.no_members"];

  return (
    <ul>
      {teamMembers.map((teamMember) => (
        <li>
          {teamMember.firstName} {teamMember.lastName} ({teamMember.email}){" "}
          {renderTeamRolesForUser(teamMember, team)}
          {renderAdditionalContent(teamMember, team)}
        </li>
      ))}
    </ul>
  );
}

function renderTeamRolesForUser(user: APIUser, highlightedTeam: APITeam) {
  // used by teams list page
  // does not include dataset managers and team names
  const tags = user.isAdmin
    ? [["Admin - Access to all Teams", "red"]]
    : user.teams
        .filter((team) => team.id === highlightedTeam.id)
        .map((team) => {
          const roleName = team.isTeamManager ? "Team Manager" : "Member";
          return [`${roleName}`, stringToColor(roleName)];
        });

  return tags.map(([text, color]) => (
    <Tag key={`${text}_${user.id}`} color={color} style={{ marginBottom: 4 }}>
      {text}
    </Tag>
  ));
}

const persistence = new Persistence<Pick<State, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "teamList",
);

class TeamListView extends React.PureComponent<Props, State> {
  state: State = {
    isLoading: true,
    teams: [],
    users: [],
    searchQuery: "",
    isTeamCreationModalVisible: false,
    isTeamEditModalVisible: false,
    selectedTeam: null,
  };

  componentDidMount() {
    // @ts-ignore
    this.setState(persistence.load());
    this.fetchData();
  }

  componentDidUpdate() {
    persistence.persist(this.state);
  }

  async fetchData(): Promise<void> {
    const [teams, users] = await Promise.all([getEditableTeams(), getEditableUsers()]);
    this.setState({
      isLoading: false,
      teams,
      users,
    });
  }

  handleSearch = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  deleteTeam = (team: APITeam) => {
    Modal.confirm({
      title: messages["team.delete"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          await deleteTeam(team.id);
          this.setState((prevState) => ({
            teams: prevState.teams.filter((t) => t.id !== team.id),
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

  createTeam = (newTeam: APITeam) => {
    this.setState((prevState) => ({
      isTeamCreationModalVisible: false,
      teams: prevState.teams.concat([newTeam]),
    }));
  };

  renderPlaceholder() {
    const teamMessage = (
      <React.Fragment>
        {"You can "}
        <a
          onClick={() =>
            this.setState({
              isTeamCreationModalVisible: true,
            })
          }
        >
          add a team
        </a>
        {" to control access to specific datasets and manage which users can be assigned to tasks."}
      </React.Fragment>
    );
    return this.state.isLoading ? null : (
      <Alert message="Add more teams" description={teamMessage} type="info" showIcon />
    );
  }

  render() {
    const marginRight = {
      marginRight: 20,
    };
    return (
      <div className="container">
        <div
          style={{
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ marginTag: number; }' is not assignable to... Remove this comment to see the full error message
            marginTag: 20,
          }}
        >
          <div className="pull-right">
            <Button
              icon={<PlusOutlined className="icon-margin-right" />}
              style={marginRight}
              type="primary"
              onClick={() =>
                this.setState({
                  isTeamCreationModalVisible: true,
                })
              }
            >
              Add Team
            </Button>
            <Search
              style={{
                width: 200,
              }}
              onChange={this.handleSearch}
              value={this.state.searchQuery}
            />
          </div>
          <h3>Teams</h3>
          <div
            className="clearfix"
            style={{
              margin: "20px 0px",
            }}
          />

          <Spin spinning={this.state.isLoading} size="large">
            {this.state.teams.length <= 1 ? this.renderPlaceholder() : null}
            <Table
              dataSource={Utils.filterWithSearchQueryAND(
                this.state.teams,
                ["name"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              expandable={{
                expandedRowRender: (team) => renderUsersForTeam(team, this.state.users),
                rowExpandable: (_team) => true,
              }}
              style={{
                marginTop: 30,
                marginBottom: 30,
              }}
            >
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy(typeHint, (team) => team.name)}
              />
              <Column
                title="Actions"
                key="actions"
                render={(__, team: APITeam) => (
                  <span>
                    <div>
                      <LinkButton
                        onClick={() =>
                          this.setState({
                            isTeamEditModalVisible: true,
                            selectedTeam: team,
                          })
                        }
                      >
                        <UserOutlined className="icon-margin-right" />
                        Add / Remove Users
                      </LinkButton>
                    </div>
                    <div>
                      <LinkButton onClick={_.partial(this.deleteTeam, team)}>
                        <DeleteOutlined className="icon-margin-right" />
                        Delete
                      </LinkButton>
                    </div>
                  </span>
                )}
              />
            </Table>
          </Spin>
          <CreateTeamModal
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ teams: never[]; isVisible: boolean; onOk: ... Remove this comment to see the full error message
            teams={this.state.teams}
            isOpen={this.state.isTeamCreationModalVisible}
            onOk={this.createTeam}
            onCancel={() =>
              this.setState({
                isTeamCreationModalVisible: false,
              })
            }
          />
          <EditTeamModalView
            isOpen={this.state.isTeamEditModalVisible}
            onCancel={() =>
              this.setState({
                isTeamEditModalVisible: false,
                selectedTeam: null,
              })
            }
            team={this.state.selectedTeam}
          />
        </div>
      </div>
    );
  }
}

export default TeamListView;
