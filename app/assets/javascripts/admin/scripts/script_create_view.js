// @flow
import { Form, Input, Select, Button, Card } from "antd";
import { type RouterHistory, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import React from "react";

import type { APIUser } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { getTeamManagerOrAdminUsers, updateScript, createScript, getScript } from "admin/admin_rest_api";

const FormItem = Form.Item;
const Option = Select.Option;

type StateProps = {
  activeUser: APIUser,
};

type Props = {
  scriptId: ?string,
  form: Object,
  history: RouterHistory,
} & StateProps;

type State = {
  users: Array<APIUser>,
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
    const users = await getTeamManagerOrAdminUsers();
    this.setState({ users: users.filter(user => user.isActive) });
  }

  async applyDefaults() {
    const script = this.props.scriptId ? await getScript(this.props.scriptId) : null;
    const defaultValues = {
      owner: script ? script.owner.id : this.props.activeUser.id,
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

        this.props.history.push("/scripts");
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const titlePrefix = this.props.scriptId ? "Update" : "Create";

    return (
      <div className="container">
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
                  {this.state.users.map((user: APIUser) => (
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

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(withRouter(Form.create()(ScriptCreateView)));
