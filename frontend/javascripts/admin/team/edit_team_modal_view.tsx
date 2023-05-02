import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import { Modal, AutoComplete, Input, Spin } from "antd";
import { DefaultOptionType } from "antd/lib/select";
import * as React from "react";
import { useEffect, useState } from "react";
import { APITeam, APITeamMembership, APIUser } from "types/api_flow_types";

type Props = {
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  team: APITeam | null;
};

function EditTeamModalForm({ onCancel, isOpen, team }: Props) {
  const [autoCompleteValue, setAutoCompleteValue] = useState("");
  const onChange = (newValue: string) => setAutoCompleteValue(newValue);
  const [users, setUsers] = useState<APIUser[] | null>(null);
  const fetchUsers = async () => setTimeout(async () => setUsers(await getEditableUsers()), 5000); // TODO delete; only testing purposes
  //const fetchUsers = async () => setUsers(await getEditableUsers());
  useEffect(() => {
    fetchUsers();
  }, []);

  if (team === null) return null;
  const filterUsersInCurrentTeam = (user: APIUser) => {
    return user.teams.map((t) => t.id).includes(team.id);
  };
  const updateTeamMembership = async (user: APIUser, newTeams: APITeamMembership[]) => {
    if (users === null) return;
    const newUser = Object.assign({}, user, {
      teams: newTeams,
    });
    const serverUser = await updateUser(newUser);
    setUsers(users.map((oldUser) => (oldUser.id === serverUser.id ? serverUser : oldUser)));
  };

  const addTo = async (user: APIUser, team: APITeam | null) => {
    if (team === null) return;
    const newTeam: APITeamMembership = { id: team.id, name: team.name, isTeamManager: false }; //TODO never make manager?
    updateTeamMembership(user, [...user.teams, newTeam]);
  };

  const removeFrom = async (user: APIUser, team: APITeam | null) => {
    const newTeams = user.teams.filter((userteam) => team?.id !== userteam.id);
    updateTeamMembership(user, newTeams);
  };

  const renderTeamMember = (user: APIUser, team: APITeam | null): DefaultOptionType => ({
    //TODO was unsure whether clicking on the name should also remove team member; same for renderUserNotInTeam
    value: `${user.firstName} ${user.lastName} ${user.email}`,
    label: (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {user.firstName} {user.lastName}
        <span onClick={() => removeFrom(user, team)}>
          <MinusOutlined /> Remove from {team?.name}
        </span>
      </div>
    ),
  });

  const renderUserNotInTeam = (user: APIUser, team: APITeam | null): DefaultOptionType => ({
    value: `${user.firstName} ${user.lastName} ${user.email}`,
    label: (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {user.firstName} {user.lastName}
        <span onClick={() => addTo(user, team)}>
          <PlusOutlined /> Add to {team?.name}
        </span>
      </div>
    ),
  });

  const options = [
    {
      label: "In team",
      options: users?.filter(filterUsersInCurrentTeam).map((user) => renderTeamMember(user, team)),
    },
    {
      label: "Not in team",
      options: users
        ?.filter((user) => !filterUsersInCurrentTeam(user))
        .map((user) => renderUserNotInTeam(user, team)),
    },
  ];

  const renderModalBody = () => {
    return (
      <AutoComplete
        style={{ width: "100%" }}
        options={options}
        filterOption={(inputValue, option) => {
          return (
            inputValue === "" ||
            (typeof option?.value === "string" &&
              option!.value?.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1)
          );
        }}
        onSelect={() => setAutoCompleteValue("")}
        value={autoCompleteValue}
        onChange={onChange}
      >
        <Input.Search size="large" placeholder="Search users" />
      </AutoComplete>
    );
  };
  const usersHaveLoaded = users !== null;

  return (
    <Modal open={isOpen} onCancel={onCancel} title="Add / Remove Users" className="edit-team-modal">
      <Spin spinning={!usersHaveLoaded}>{usersHaveLoaded ? renderModalBody() : null}</Spin>
    </Modal>
  );
}

const EditTeamModalView = EditTeamModalForm;
export default EditTeamModalView;
