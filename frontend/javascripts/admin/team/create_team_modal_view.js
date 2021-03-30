// @flow

import "@ant-design/compatible/assets/index.css";
import { Modal, Input, Form } from "antd";
import * as React from "react";

import { createTeam } from "admin/admin_rest_api";

const FormItem = Form.Item;

type Props = {
  onOk: Function,
  onCancel: Function,
  isVisible: boolean,
};

function CreateTeamModalForm({ onOk: onOkCallback, onCancel, isVisible }: Props) {
  const [form] = Form.useForm();
  const onOk = async () => {
    form.validateFields(async (err, values) => {
      if (err) {
        return;
      }
      const newTeam = {
        name: values.teamName,
        roles: [{ name: "admin" }, { name: "user" }],
      };

      const team = await createTeam(newTeam);
      onOkCallback(team);
    });
  };

  const { getFieldDecorator } = form;
  return (
    <Modal visible={isVisible} title="Add a New Team" okText="Ok" onCancel={onCancel} onOk={onOk}>
      <Form layout="vertical">
        <FormItem label="Team Name">
          {getFieldDecorator("teamName", {
            rules: [
              {
                required: true,
                pattern: "^[A-Za-z0-9\\-_\\. ß]+$",
                message: "The team name must not contain any special characters.",
              },
            ],
          })(<Input icon="tag-o" placeholder="Team Name" autoFocus />)}
        </FormItem>
      </Form>
    </Modal>
  );
}
const CreateTeamModalView = CreateTeamModalForm;
export default CreateTeamModalView;
