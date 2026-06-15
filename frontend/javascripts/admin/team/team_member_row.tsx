import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { updateUser } from "admin/rest_api";
import { Button, Select, Spin, Tooltip } from "antd";
import LinkButton from "components/link_button";
import { handleGenericError } from "libs/error_handling";
import { useState } from "react";
import type { APITeam, APITeamMembership, APIUser } from "types/api_types";
import { filterTeamMembersOf, renderUsersForTeam } from "./team_list_view";

export function TeamMembersRow({ team, users }: { team: APITeam; users: APIUser[] }) {
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
    <Spin spinning={isUpdating}>
      <div style={{ marginLeft: 32 }}>
        {renderUsersForTeam(team, users, renderRemoveButton)}
        <div style={{ marginTop: 8 }}>{addUserControl}</div>
      </div>
    </Spin>
  );
}
