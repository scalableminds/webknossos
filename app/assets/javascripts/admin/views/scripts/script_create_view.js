// @flow
import React from "react";
import { Form, Input, Select, Button, Card } from "antd";
import app from "app";
import { getAdminUsers, updateScript, createScript, getScript } from "admin/admin_rest_api";
import type { APIUserType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;

type Props = {
  scriptId: ?string,
  form: Object,
};

type State = {
  users: Array<APIUserType>,
};

class ScriptCreateView extends React.PureComponent<Props, State> {
  state = {
    users: [],
  };
  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async fetchData() {
    const users = await getAdminUsers();
    this.setState({ users: users.filter(user => user.isActive) });
  }

  async applyDefaults() {
    const script = this.props.scriptId ? await getScript(this.props.scriptId) : null;
    const defaultValues = {
      owner: script ? script.owner.id : app.currentUser.id,
    };

    const defaultFormValues = Object.assign({}, script, defaultValues);
    this.props.form.setFieldsValue(defaultFormValues);
  }

  handleSubmit = e => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        if (this.props.scriptId) {
          await updateScript(this.props.scriptId, formValues);
        } else {
          await createScript(formValues);
        }

        app.router.navigate("/scripts", { trigger: true });
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const titlePrefix = this.props.scriptId ? "Update" : "Create";

    return (
      <div className="container wide" style={{ paddingTop: 20 }}>
        <Card title={<h3>{titlePrefix} Script</h3>}>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="Script Name" hasFeedback>
              {getFieldDecorator("name", {
                rules: [
                  {
                    required: true,
                  },
                  { min: 3 },
                ],
              })(<Input autoFocus />)}
            </FormItem>

            <FormItem label="Gist URL" hasFeedback>
              {getFieldDecorator("gist", {
                rules: [
                  {
                    required: true,
                  },
                  { type: "url" },
                ],
              })(<Input />)}
            </FormItem>

            <FormItem label="Owner" hasFeedback>
              {getFieldDecorator("owner", {
                rules: [
                  {
                    required: true,
                  },
                ],
              })(
                <Select
                  showSearch
                  placeholder="Select a User"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                >
                  {this.state.users.map((user: APIUserType) => (
                    <Option key={user.id} value={user.id}>
                      {`${user.lastName}, ${user.firstName} ${user.email}`}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem>
              <Button type="primary" htmlType="submit">
                {titlePrefix} Script
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );
  }
}

export default Form.create()(ScriptCreateView);
