import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { updateUser } from "admin/rest_api";
import { Button, Select, Tag, Tooltip } from "antd";
import { Flex } from "antd/lib";
import { handleGenericError } from "libs/error_handling";
import { stringToColor } from "libs/format_utils";
import messages from "messages";
import { useState } from "react";
import type { APITeam, APITeamMembership, APIUser } from "types/api_types";

export function isUserInTeam(user: APIUser, team: APITeam): boolean {
  return user.teams.some((userTeam: APITeamMembership) => userTeam.id === team.id) || user.isAdmin;
}

function TeamRolesForUser({ user, highlightedTeam }: { user: APIUser; highlightedTeam: APITeam }) {
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

function TeamMemberList({
  team,
  allUsers,
  renderAdditionalContent = (_teamMember: APIUser, _team: APITeam) => null,
}: {
  team: APITeam;
  allUsers: APIUser[];
  renderAdditionalContent: (_teamMember: APIUser, _team: APITeam) => React.ReactNode;
}) {
  const teamMembers = allUsers
    .filter((user) => isUserInTeam(user, team))
    .filter((user) => user.isActive);
  if (teamMembers.length === 0) return messages["team.no_members"];

  return (
    <Flex vertical gap={4}>
      {teamMembers.map((teamMember) => (
        <Flex key={`team_member_${teamMember.id}`} align="center" gap="small">
          <span>
            {teamMember.firstName} {teamMember.lastName} ({teamMember.email})
          </span>
          <TeamRolesForUser user={teamMember} highlightedTeam={team} />
          {renderAdditionalContent(teamMember, team)}
        </Flex>
      ))}
    </Flex>
  );
}

export function TeamMembersRow({ team, users }: { team: APITeam; users: APIUser[] }) {
  const queryClient = useQueryClient();
  const [isAddingUser, setIsAddingUser] = useState(false);

  async function updateTeamMembership(user: APIUser, newTeams: APITeamMembership[]) {
    try {
      await updateUser({ ...user, teams: newTeams });
      await queryClient.invalidateQueries({ queryKey: ["editableUsers"] });
    } catch (error) {
      handleGenericError(error as Error);
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
      <Tooltip title={`Remove ${user.firstName} from ${team.name}`}>
        <Button
          variant="text"
          color="danger"
          size="small"
          onClick={() => removeUser(user)}
          icon={<MinusCircleOutlined />}
        />
      </Tooltip>
    );
  };

  const usersNotInTeam = users.filter((user) => user.isActive && !isUserInTeam(user, team));

  const addUserControl = isAddingUser ? (
    <Select
      autoFocus
      defaultOpen
      showSearch={{ optionFilterProp: "label" }}
      style={{ width: 350 }}
      placeholder="Search users"
      value={null}
      options={usersNotInTeam.map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName} (${user.email})`,
      }))}
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
    <div style={{ marginLeft: 32 }}>
      <TeamMemberList team={team} allUsers={users} renderAdditionalContent={renderRemoveButton} />
      <div style={{ marginTop: 8 }}>{addUserControl}</div>
    </div>
  );
}
