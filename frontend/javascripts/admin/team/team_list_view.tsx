import { DeleteOutlined, PlusOutlined, UserOutlined } from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { useQueryClient } from "@tanstack/react-query";
import AdminPage from "admin/admin_page";
import { deleteTeam as deleteTeamAPI, getEditableTeams, getEditableUsers } from "admin/rest_api";
import CreateTeamModal from "admin/team/create_team_modal_view";
import { App, Button, Input, Space, Spin, Table, Tag, Tooltip } from "antd";
import LinkButton from "components/link_button";
import { handleGenericError } from "libs/error_handling";
import { stringToColor } from "libs/format_utils";
import Persistence from "libs/persistence";
import { useQueryWithErrorHandling } from "libs/react_hooks";
import { filterWithSearchQueryAND, localeCompareBy } from "libs/utils";
import messages from "messages";
import type React from "react";
import { useState } from "react";
import type { APITeam, APIUser } from "types/api_types";
import { isUserInTeam, TeamMembersRow } from "./team_member_row";

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
    return users.filter((user) => user.isActive && isUserInTeam(user, team)).length;
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
            expandedRowRender: (team) => <TeamMembersRow team={team} users={users} />,
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
              <Space orientation="vertical" size={0}>
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
