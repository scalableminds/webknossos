import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import { Modal, Input, Spin } from "antd";
import * as React from "react";
import { useEffect, useState } from "react";
import { APITeam, APITeamMembership, APIUser } from "types/api_flow_types";
import { filterTeamMembersOf, renderUsersForTeam } from "./team_list_view";

type Props = {
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  team: APITeam | null;
};

function EditTeamModalForm({ onCancel, isOpen, team }: Props) {
  const [autoCompleteValue, setAutoCompleteValue] = useState("");
  const onChange = (newValue: string) => setAutoCompleteValue(newValue);
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<APIUser[] | null>(null);
  const fetchUsers = async () => setTimeout(async () => setUsers(await getEditableUsers()), 5000); // TODO delete; only testing purposes
  //const fetchUsers = async () => setUsers(await getEditableUsers());
  useEffect(() => {
    fetchUsers();
  }, []);

  if (team === null) return null;
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
    const newTeam: APITeamMembership = { id: team.id, name: team.name, isTeamManager: false };
    updateTeamMembership(user, [...user.teams, newTeam]);
  };

  const removeFrom = async (user: APIUser, team: APITeam | null) => {
    const newTeams = user.teams.filter((userteam) => team?.id !== userteam.id);
    updateTeamMembership(user, newTeams);
  };

  const renderRemoveSpan = (user: APIUser) => {
    if (user.isAdmin) {
      return <span>Admin</span>;
    }
    return (
      <span onClick={() => removeFrom(user, team)}>
        <MinusOutlined /> Remove from {team?.name}
      </span>
    );
  };

  const renderTeamMember = (user: APIUser) => {
    //TODO was unsure whether clicking on the name should also remove team member; same for renderUserNotInTeam
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
        onMouseDown={(e) => {
          console.log("yes hi");
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {user.firstName} {user.lastName}
        {renderRemoveSpan(user)}
      </div>
    );
  };

  const renderUserNotInTeam = (user: APIUser) => {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
        onMouseDown={(e) => {
          console.log("yes hi");
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {user.firstName} {user.lastName}
        <span
          onClick={() => {
            addTo(user, team);
          }}
        >
          <PlusOutlined /> Add to {team?.name}
        </span>
      </div>
    );
  };

  const renderOptions = () => {
    return (
      <>
        <div style={{ margin: "16px" }}>
          In team
          {users
            ?.filter((user) => filterTeamMembersOf(team, user))
            .map((user) => renderTeamMember(user))}
        </div>
        <div style={{ margin: "16px" }}>
          Not in team
          {users
            ?.filter((user) => !filterTeamMembersOf(team, user))
            .map((user) => renderUserNotInTeam(user))}
        </div>
      </>
    );
  };

  const renderModalBody = () => {
    return (
      <>
        <Select
          style={{ width: "100%", marginBottom: "16px" }}
          dropdownRender={() => renderOptions()}
          filterOption={(inputValue, option) => {
            return (
              inputValue === "" ||
              (typeof option?.value === "string" &&
                option?.value?.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1)
            );
          }}
          onSelect={() => setAutoCompleteValue("")}
          value={autoCompleteValue}
          onChange={onChange}
          showSearch
          placeholder="Search for user"
          showArrow={false}
          autoFocus
          open={open}
          onDropdownVisibleChange={(visible) => setOpen(visible)}
        >
          <Input.Search size="large" placeholder="Search users" />
        </Select>
        {renderUsersForTeam(team, users)}
      </>
    );
  };
  const usersHaveLoaded = users !== null;

  return (
    <Modal
      open={isOpen}
      onCancel={onCancel}
      title="Add / Remove Users"
      className="edit-team-modal"
      footer={null}
    >
      <Spin spinning={!usersHaveLoaded}>{usersHaveLoaded ? renderModalBody() : null}</Spin>
    </Modal>
  );
}

const EditTeamModalView = EditTeamModalForm;
export default EditTeamModalView;
