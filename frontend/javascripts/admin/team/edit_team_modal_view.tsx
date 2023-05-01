// import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { getEditableUsers, updateUser } from "admin/admin_rest_api";
import { Modal, Form, AutoComplete, Input, Button } from "antd";
import { DefaultOptionType } from "antd/lib/select";
import { useFetch } from "libs/react_helpers";
import * as React from "react";
import { APITeam, APIUser } from "types/api_flow_types";

type Props = {
  //   onOk: (...args: Array<any>) => any;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  team: APITeam | null;
};

function EditTeamModalForm({ onCancel, isOpen, team }: Props) {
  //onOk: onOkCallback, onCancel,
  const [form] = Form.useForm();
  const users = useFetch(getEditableUsers, [], []);
  if (team === null) return null;
  const filterFunc = (user: APIUser) => {
    return user.teams.map((t) => t.id).includes(team.id);
  }; //rename me
  const addTo = (user: APIUser, team: APITeam | null) => {
    const newTeams = [...user.teams, team];
    const newUser = Object.assign({}, user, {
      teams: newTeams,
    });
    updateUser(newUser).then(
      (serverUser) => Promise.resolve(serverUser),
      () => Promise.reject(user),
    );
  };
  const removeFrom = (user: APIUser, team: APITeam | null) => {
    const newTeams = user.teams.filter((userteam) => team?.id !== userteam.id);
    const newUser = Object.assign({}, user, {
      teams: newTeams,
    });
    updateUser(newUser).then(
      (serverUser) => Promise.resolve(serverUser),
      () => Promise.reject(user),
    );
  };
  const renderTeamMember = (user: APIUser, team: APITeam | null): DefaultOptionType => ({
    value: `${user.firstName} ${user.lastName}.${user.id}`,
    label: (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {user.firstName} {user.lastName}
        <span>
          <Button onClick={() => removeFrom(user, team)} /> Remove from {team}
        </span>
      </div>
    ),
  });

  const renderUserNotInTeam = (user: APIUser, team: APITeam | null): DefaultOptionType => ({
    value: `${user.firstName} ${user.lastName}.${user.id}`,
    label: (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {user.firstName} {user.lastName}
        <span>
          <Button onClick={() => addTo(user, team)} /> Add to {team}
        </span>
      </div>
    ),
  });

  const options = [
    {
      label: "In team",
      options: users.filter(filterFunc).map((user) => renderTeamMember(user, team)),
    },
    {
      label: "Not in team",
      options: users
        .filter((user) => !filterFunc(user))
        .map((user) => renderUserNotInTeam(user, team)),
    },
  ];
  return (
    <>
      <Modal
        open={isOpen}
        onCancel={onCancel}
        title="Add / Remove Users"
        okText="Ok"
        className="edit-team-modal"
      >
        <Form layout="vertical" form={form}>
          <AutoComplete
            style={{ width: "100%" }}
            options={options}
            filterOption={(inputValue, option) => {
              //debugger;
              return (
                typeof option?.value === "string" &&
                option!.value?.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
              );
            }}
            autoFocus
          >
            <Input.Search size="large" placeholder="Search users" />
          </AutoComplete>
        </Form>
      </Modal>
    </>
  );
}

const EditTeamModalView = EditTeamModalForm;
export default EditTeamModalView;
