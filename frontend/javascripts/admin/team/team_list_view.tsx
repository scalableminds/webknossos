import { DeleteOutlined, MinusCircleOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { useQueryClient } from "@tanstack/react-query";
import AdminPage from "admin/admin_page";
import {
  deleteTeam as deleteTeamAPI,
  getEditableTeams,
  getEditableUsers,
  updateUser,
} from "admin/rest_api";
import CreateTeamModal from "admin/team/create_team_modal_view";
import { App, Button, Flex, Input, Select, Space, Spin, Table, Tag, Tooltip } from "antd";
import LinkButton from "components/link_button";
import { handleGenericError } from "libs/error_handling";
import { stringToColor } from "libs/format_utils";
import Persistence from "libs/persistence";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import { filterWithSearchQueryAND, localeCompareBy } from "libs/utils";
import messages from "messages";
import type React from "react";
import { useState } from "react";
import type { APITeam, APITeamMembership, APIUser } from "types/api_types";

const { Column } = Table;
const { Search } = Input;

export function renderTeamRolesAndPermissionsForUser(user: APIUser) {
  //used by user list page
  const tags = [
    ...(user.isOrganizationOwner
      ? [
          [
            "Organization Owner",
            "cyan",
            "Organization owners have access to all teams and datasets.",
          ],
        ]
      : []),
    ...(user.isGuest
      ? [["Guest User", "lime", "Guest users do not count against your organization’s user quota."]]
      : []),
    ...(user.isAdmin
      ? [["Admin - Access to all Teams", "red", "Admins have access to all teams and datasets."]]
      : [
          ...(user.isDatasetManager
            ? [
                [
                  "Dataset Manager - Edit all Datasets",
                  "geekblue",
                  "Dataset managers have access to all datasets.",
                ],
              ]
            : []),
          ...user.teams.map((team) => {
            const roleName = team.isTeamManager ? "Team Manager" : "Member";
            return [`${team.name}: ${roleName}`, stringToColor(roleName)];
          }),
        ]),
  ];

  const tagElements = tags.map(([text, color, tooltipText]) => (
    <Tooltip title={tooltipText} key={`tooltip-${text}_${user.id}`}>
      <Tag key={`tag-${text}_${user.id}`} color={color} variant="outlined">
        {text}
      </Tag>
    </Tooltip>
  ));

  return <Space wrap>{tagElements}</Space>;
}

export function filterTeamMembersOf(team: APITeam, user: APIUser): boolean {
  return user.teams.some((userTeam: APITeamMembership) => userTeam.id === team.id) || user.isAdmin;
}

export function renderUsersForTeam(
  team: APITeam,
  allUsers: APIUser[],
  renderAdditionalContent = (_teamMember: APIUser, _team: APITeam): React.ReactNode => {
    return null;
  },
) {
  const teamMembers = allUsers
    .filter((user) => filterTeamMembersOf(team, user))
    .filter((user) => user.isActive);
  if (teamMembers.length === 0) return messages["team.no_members"];

  return (
    <Flex vertical gap={4}>
      {teamMembers.map((teamMember) => (
        <Flex key={`team_member_${teamMember.id}`} align="center" gap="small">
          <span>
            {teamMember.firstName} {teamMember.lastName} ({teamMember.email})
          </span>
          {renderTeamRolesForUser(teamMember, team)}
          {renderAdditionalContent(teamMember, team)}
        </Flex>
      ))}
    </Flex>
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
    <Tag key={`${text}_${user.id}`} color={color} style={{ marginInlineEnd: 0 }} variant="outlined">
      {text}
    </Tag>
  ));
}

function TeamMembersPanel({ team, users }: { team: APITeam; users: APIUser[] }) {
  const queryClient = useQueryClient();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAddingUser, setIsAddingUser] = useState(false);

  async function updateTeamMembership(user: APIUser, newTeams: APITeamMembership[]) {
    try {
      setIsUpdating(true);
      await updateUser({ ...user, teams: newTeams });
      await queryClient.invalidateQueries({ queryKey: ["editableUsers"] });
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsUpdating(false);
    }
  }

  function addUser(userId: string | null) {
    const user = users.find((u) => u.id === userId);
    if (user == null) return;
    const newTeam: APITeamMembership = { id: team.id, name: team.name, isTeamManager: false };
    updateTeamMembership(user, [...user.teams, newTeam]);
  }

  function removeUser(user: APIUser) {
    updateTeamMembership(
      user,
      user.teams.filter((userTeam) => userTeam.id !== team.id),
    );
  }

  const renderRemoveButton = (user: APIUser, _team: APITeam) => {
    if (user.isAdmin) return null;
    return (
      <Tooltip title={`Remove from ${team.name}`}>
        <LinkButton size="small" onClick={() => removeUser(user)} icon={<MinusCircleOutlined />} />
      </Tooltip>
    );
  };

  const usersNotInTeam = users.filter((user) => user.isActive && !filterTeamMembersOf(team, user));

  const addUserControl = isAddingUser ? (
    <Select
      autoFocus
      defaultOpen
      showSearch
      style={{ width: 350 }}
      placeholder="Search users"
      value={null}
      options={usersNotInTeam.map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName} (${user.email})`,
      }))}
      optionFilterProp="label"
      onSelect={(userId) => {
        setIsAddingUser(false);
        addUser(userId);
      }}
      onBlur={() => setIsAddingUser(false)}
      onOpenChange={(open) => {
        if (!open) setIsAddingUser(false);
      }}
    />
  ) : (
    <Button
      type="dashed"
      size="small"
      icon={<PlusOutlined />}
      onClick={() => setIsAddingUser(true)}
    >
      Add user
    </Button>
  );

  return (
    <Spin spinning={isUpdating}>
      <div style={{ marginLeft: 32 }}>
        {renderUsersForTeam(team, users, renderRemoveButton)}
        <div style={{ marginTop: 8 }}>{addUserControl}</div>
      </div>
    </Spin>
  );
}

const persistence = new Persistence<Pick<{ searchQuery: string }, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "teamList",
);

function TeamListView() {
  const queryClient = useQueryClient();

  const { data: teams = [], isFetching: isLoadingTeams } = useQueryWithErrorHandling({
    queryKey: ["editableTeams"],
    queryFn: getEditableTeams,
    refetchOnWindowFocus: false,
  });
  const { data: users = [], isFetching: isLoadingUsers } = useQueryWithErrorHandling({
    queryKey: ["editableUsers"],
    queryFn: getEditableUsers,
    refetchOnWindowFocus: false,
  });

  const [searchQuery, setSearchQuery] = useState(() => persistence.load().searchQuery || "");
  const [isLoadingMutation, setIsLoadingMutation] = useState(false);
  const [isTeamCreationModalVisible, setIsTeamCreationModalVisible] = useState(false);
  const [expandedTeamIds, setExpandedTeamIds] = useState<readonly React.Key[]>([]);

  const isLoading = isLoadingTeams || isLoadingUsers || isLoadingMutation;

  const { modal } = App.useApp();

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    const newSearchQuery = event.target.value;
    setSearchQuery(newSearchQuery);
    persistence.persist({ searchQuery: newSearchQuery });
  }

  function deleteTeam(team: APITeam) {
    modal.confirm({
      title: messages["team.delete"],
      onOk: async () => {
        try {
          setIsLoadingMutation(true);
          await deleteTeamAPI(team.id);
          queryClient.setQueryData(["editableTeams"], (currentTeams: APITeam[]) =>
            currentTeams.filter((t) => t.id !== team.id),
          );
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoadingMutation(false);
        }
      },
    });
  }

  function createTeam(newTeam: APITeam) {
    setIsTeamCreationModalVisible(false);
    queryClient.setQueryData(["editableTeams"], (currentTeams: APITeam[]) => [
      ...currentTeams,
      newTeam,
    ]);
  }

  function countActiveMembers(team: APITeam) {
    return users.filter((user) => user.isActive && filterTeamMembersOf(team, user)).length;
  }

  function expandTeamRow(team: APITeam, event: React.MouseEvent) {
    event.stopPropagation();
    setExpandedTeamIds((teamIds) => (teamIds.includes(team.id) ? teamIds : [...teamIds, team.id]));
  }

  return (
    <AdminPage
      title="Teams"
      descriptionURI="https://docs.webknossos.org/webknossos/users/teams.html"
      description="Create teams and manage their members. Team membership determines which datasets, tasks, and projects a user can access."
      actions={
        <Button
          icon={<PlusOutlined />}
          type="primary"
          onClick={() => setIsTeamCreationModalVisible(true)}
        >
          Add Team
        </Button>
      }
      search={<Search allowClear onChange={handleSearch} value={searchQuery} />}
    >
      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={filterWithSearchQueryAND(teams, ["name"], searchQuery)}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
          }}
          expandable={{
            expandedRowRender: (team) => <TeamMembersPanel team={team} users={users} />,
            rowExpandable: (_team) => true,
            expandRowByClick: true,
            expandedRowKeys: expandedTeamIds,
            onExpandedRowsChange: setExpandedTeamIds,
          }}
        >
          <Column
            title="Name"
            dataIndex="name"
            key="name"
            sorter={localeCompareBy<APITeam>((team) => team.name)}
          />
          <Column
            title="Members"
            key="members"
            width={150}
            render={(__, team: APITeam) => countActiveMembers(team)}
            sorter={(teamA: APITeam, teamB: APITeam) =>
              countActiveMembers(teamA) - countActiveMembers(teamB)
            }
          />
          <Column
            title="Actions"
            key="actions"
            render={(__, team: APITeam) => (
              <Space direction="vertical" size={0}>
                <LinkButton onClick={(event) => expandTeamRow(team, event)} icon={<UserOutlined />}>
                  Manage users
                </LinkButton>
                <LinkButton
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteTeam(team);
                  }}
                  icon={<DeleteOutlined />}
                >
                  Delete
                </LinkButton>
              </Space>
            )}
          />
        </Table>
      </Spin>
      <CreateTeamModal
        isOpen={isTeamCreationModalVisible}
        onOk={createTeam}
        onCancel={() => setIsTeamCreationModalVisible(false)}
      />
    </AdminPage>
  );
}

export default TeamListView;
