import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import { Modal, AutoComplete, Input, Spin, Tooltip } from "antd";
import { DefaultOptionType } from "antd/lib/select";
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
  const [dropDownVisible, setDropDownVisible] = useState(false);
  const onChange = (newValue: string) => setAutoCompleteValue(newValue);
  const [users, setUsers] = useState<APIUser[] | null>(null);
  const [pendingRequestsCounter, setPendingRequestsCounter] = useState(0);
  const fetchUsers = async () => setTimeout(async () => setUsers(await getEditableUsers()), 2000); //TODO
  useEffect(() => {
    fetchUsers();
  }, []);

  if (team === null) return null;
  const updateTeamMembership = async (user: APIUser, newTeams: APITeamMembership[]) => {
    setPendingRequestsCounter(1);
    setDropDownVisible(false);
    if (users === null) return;
    const newUser = Object.assign({}, user, {
      teams: newTeams,
    });
    const serverUser = await updateUser(newUser);
    setUsers(users.map((oldUser) => (oldUser.id === serverUser.id ? serverUser : oldUser)));
    setTimeout(async () => await setPendingRequestsCounter(0), 2000); //TODO
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
      return (
        <Tooltip title="Admins cannot be removed because they can access all teams.">
          <span>Admin</span>
        </Tooltip>
      );
    }
    return (
      <span onClick={() => removeFrom(user, team)}>
        <MinusOutlined /> Remove from {team?.name}
      </span>
    );
  };

  const renderTeamMember = (user: APIUser): DefaultOptionType => ({
    value: `${user.firstName} ${user.lastName} ${user.email}`,
    label: (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {user.firstName} {user.lastName}
        {renderRemoveSpan(user)}
      </div>
    ),
  });

  const renderUserNotInTeam = (user: APIUser): DefaultOptionType => ({
    value: `${user.firstName} ${user.lastName} ${user.email}`,
    label: (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          {user.firstName} {user.lastName}
        </span>
        <span onClick={() => addTo(user, team)}>
          <PlusOutlined /> Add to {team?.name}
        </span>
      </div>
    ),
  });

  const options: DefaultOptionType[] = [
    {
      label: "In team",
      options: users
        ?.filter((user) => filterTeamMembersOf(team, user))
        .map((user) => renderTeamMember(user)),
    },
    {
      label: "Not in team",
      options: users
        ?.filter((user) => !filterTeamMembersOf(team, user))
        .map((user) => renderUserNotInTeam(user)),
    },
  ];

  const renderModalBody = () => {
    return (
      <>
        <Spin spinning={pendingRequestsCounter > 0}>
          <AutoComplete
            style={{ width: "100%", marginBottom: "16px" }}
            options={options}
            filterOption={(inputValue, option) => {
              return (
                inputValue === "" ||
                (typeof option?.value === "string" &&
                  option?.value?.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1)
              );
            }}
            onSelect={() => {
              setAutoCompleteValue("");
            }}
            value={autoCompleteValue}
            onChange={onChange}
            open={dropDownVisible}
            onFocus={() => setDropDownVisible(true)}
            onBlur={() => setDropDownVisible(false)}
            onSearch={() => setDropDownVisible(true)}
            onDropdownVisibleChange={() => setAutoCompleteValue("")}
          >
            <Input.Search size="large" placeholder="Search users" />
          </AutoComplete>
          {renderUsersForTeam(team, users)}
        </Spin>
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
