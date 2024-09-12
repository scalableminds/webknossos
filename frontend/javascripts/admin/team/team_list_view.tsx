import { PropTypes } from "@scalableminds/prop-types";
import { Table, Spin, Button, Input, Alert, Tag, App } from "antd";
import { DeleteOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import type { APITeam, APITeamMembership, APIUser } from "types/api_flow_types";
import {
  getEditableTeams,
  deleteTeam as deleteTeamAPI,
  getEditableUsers,
} from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import LinkButton from "components/link_button";
import CreateTeamModal from "admin/team/create_team_modal_view";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import messages from "messages";
import { stringToColor } from "libs/format_utils";
import EditTeamModalView from "./edit_team_modal_view";
import { useEffect, useState } from "react";

const { Column } = Table;
const { Search } = Input;

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
  renderAdditionalContent = (_teamMember: APIUser, _team: APITeam): React.ReactNode => {
    return null;
  },
) {
  if (allUsers === null) return;
  const teamMembers = allUsers.filter((user) => filterTeamMembersOf(team, user));
  if (teamMembers.length === 0) return messages["team.no_members"];

  return (
    <ul>
      {teamMembers.map((teamMember) => (
        <li key={`team_member_${teamMember.id}`}>
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

const persistence = new Persistence<Pick<{ searchQuery: string }, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "teamList",
);

function TeamListView() {
  const [isLoading, setIsLoading] = useState(true);
  const [teams, setTeams] = useState<APITeam[]>([]);
  const [users, setUsers] = useState<APIUser[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isTeamCreationModalVisible, setIsTeamCreationModalVisible] = useState(false);
  const [isTeamEditModalVisible, setIsTeamEditModalVisible] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<APITeam | null>(null);

  const { modal } = App.useApp();

  useEffect(() => {
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
    fetchData();
  }, []);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  async function fetchData(): Promise<void> {
    const [teams, users] = await Promise.all([getEditableTeams(), getEditableUsers()]);

    setUsers(users);
    setTeams(teams);
    setIsLoading(false);
  }

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function deleteTeam(team: APITeam) {
    modal.confirm({
      title: messages["team.delete"],
      onOk: async () => {
        try {
          setIsLoading(true);
          await deleteTeamAPI(team.id);
          setTeams(teams.filter((t: APITeam) => t.id !== team.id));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }

  function createTeam(newTeam: APITeam) {
    setIsTeamCreationModalVisible(false);
    setTeams([...teams, newTeam]);
  }

  function renderPlaceholder() {
    const teamMessage = (
      <React.Fragment>
        {"You can "}
        <a onClick={() => setIsTeamCreationModalVisible(true)}>add a team</a>
        {" to control access to specific datasets and manage which users can be assigned to tasks."}
      </React.Fragment>
    );
    return isLoading ? null : (
      <Alert message="Add more teams" description={teamMessage} type="info" showIcon />
    );
  }

  const marginRight = {
    marginRight: 20,
  };
  return (
    <div className="container">
      <div className="pull-right">
        <Button
          icon={<PlusOutlined className="icon-margin-right" />}
          style={marginRight}
          type="primary"
          onClick={() => setIsTeamCreationModalVisible(true)}
        >
          Add Team
        </Button>
        <Search
          style={{
            width: 200,
          }}
          onChange={handleSearch}
          value={searchQuery}
        />
      </div>
      <h3>Teams</h3>
      <div
        className="clearfix"
        style={{
          margin: "20px 0px",
        }}
      />

      <Spin spinning={isLoading} size="large">
        {teams.length <= 1 ? renderPlaceholder() : null}
        <Table
          dataSource={Utils.filterWithSearchQueryAND(teams, ["name"], searchQuery)}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
          }}
          expandable={{
            expandedRowRender: (team) => renderUsersForTeam(team, users),
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
            sorter={Utils.localeCompareBy<APITeam>((team) => team.name)}
          />
          <Column
            title="Actions"
            key="actions"
            render={(__, team: APITeam) => (
              <span>
                <div>
                  <LinkButton
                    onClick={() => {
                      setSelectedTeam(team);
                      setIsTeamEditModalVisible(true);
                    }}
                  >
                    <UserOutlined className="icon-margin-right" />
                    Add / Remove Users
                  </LinkButton>
                </div>
                <div>
                  <LinkButton onClick={_.partial(deleteTeam, team)}>
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
        isOpen={isTeamCreationModalVisible}
        onOk={createTeam}
        onCancel={() => setIsTeamCreationModalVisible(false)}
      />
      <EditTeamModalView
        isOpen={isTeamEditModalVisible}
        onCancel={() => {
          setIsTeamEditModalVisible(false);
          setSelectedTeam(null);
        }}
        team={selectedTeam}
      />
    </div>
  );
}

export default TeamListView;
