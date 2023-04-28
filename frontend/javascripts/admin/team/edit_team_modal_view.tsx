import { TeamOutlined } from "@ant-design/icons";
import { getEditableUsers } from "admin/admin_rest_api";
import { Modal, Form, AutoComplete, Input } from "antd";
import { DefaultOptionType } from "antd/lib/select";
import { useFetch } from "libs/react_helpers";
import * as React from "react";
import { APITeam, APIUser } from "types/api_flow_types";
const FormItem = Form.Item;

const renderItem = (user: APIUser, team: string | null): DefaultOptionType => ({
  value: `${user.firstName} ${user.lastName}.${user.id}`, //make unique
  label: (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
      }}
    >
      {user.firstName} {user.lastName}
      <span>
        <TeamOutlined /> {team}
      </span>
    </div>
  ),
});

type Props = {
  //   onOk: (...args: Array<any>) => any;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
  team: APITeam | null;
};
type State = {
  isLoading: boolean;
  teams: APITeam[];
  users: APIUser[];
};

function EditTeamModalForm({ onCancel, isOpen, team }: Props) {
  //onOk: onOkCallback, onCancel,
  const [form] = Form.useForm();
  const users = useFetch(getEditableUsers, [], []);
  if (team === null) return null;
  const filterFunc = (user: APIUser) => {
    return user.teams.map((t) => t.id).includes(team.id);
  }; //rename me
  const options = [
    {
      label: "in the team",
      options: users.filter(filterFunc).map((user) => renderItem(user, team?.name)),
    },
    {
      label: "not in the team",
      options: users
        .filter((user) => !filterFunc(user))
        .map((user) => renderItem(user, team?.name)),
    },
  ];

  users.map((user) => renderItem(user, team?.name));
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
