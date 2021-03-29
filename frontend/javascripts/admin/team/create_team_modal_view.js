// @flow
import { Form } from '@ant-design/compatible';

import '@ant-design/compatible/assets/index.css';
import { Modal, Input } from "antd";
import * as React from "react";

import { createTeam } from "admin/admin_rest_api";

const FormItem = Form.Item;

type Props = {
  onOk: Function,
  onCancel: Function,
  isVisible: boolean,
  form: Object,
};

class CreateTeamModalForm extends React.PureComponent<Props> {
  onOk = async () => {
    this.props.form.validateFields(async (err, values) => {
      if (err) {
        return;
      }
      const newTeam = {
        name: values.teamName,
        roles: [{ name: "admin" }, { name: "user" }],
      };

      const team = await createTeam(newTeam);

      this.props.onOk(team);
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    return (
      <Modal
        visible={this.props.isVisible}
        title="Add a New Team"
        okText="Ok"
        onCancel={this.props.onCancel}
        onOk={this.onOk}
      >
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
}
const CreateTeamModalView = Form.create()(CreateTeamModalForm);
export default CreateTeamModalView;
