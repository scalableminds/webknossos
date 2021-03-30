// @flow
import { Form, Input, Select, Button, Card, Spin } from "antd";
import { type RouterHistory, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import React, { useState, useEffect } from "react";

import type { APIUser } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getTeamManagerOrAdminUsers,
  updateScript,
  createScript,
  getScript,
} from "admin/admin_rest_api";

const FormItem = Form.Item;
const { Option } = Select;

type OwnProps = {|
  scriptId?: ?string,
|};
type StateProps = {|
  activeUser: APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {|
  history: RouterHistory,
  ...Props,
|};

function ScriptCreateView({ scriptId, activeUser, history }: PropsWithRouter) {
  const [users, setUsers] = useState < Array < APIUser >> [];
  const [isFetchingData: boolean, setIsFetchingData] = useState<boolean>(false);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchData();
    applyDefaults();
  }, []);

  async function fetchData() {
    setIsFetchingData(true);
    const fetchedUsers = await getTeamManagerOrAdminUsers();
    const onlyActiveUsers = fetchedUsers.filter(user => user.isActive);
    setUsers(onlyActiveUsers);
    setIsFetchingData(false);
  }

  async function applyDefaults() {
    const script = scriptId ? await getScript(scriptId) : null;
    const defaultValues = {
      owner: script ? script.owner.id : activeUser.id,
    };

    const defaultFormValues = Object.assign({}, script, defaultValues);
    form.setFieldsValue(defaultFormValues);
  }

  const handleSubmit = e => {
    e.preventDefault();
    form.validateFields(async (err, formValues) => {
      if (!err) {
        if (scriptId) {
          await updateScript(scriptId, formValues);
        } else {
          await createScript(formValues);
        }
        history.push("/scripts");
      }
    });
  };

  const { getFieldDecorator } = form;
  const titlePrefix = scriptId ? "Update" : "Create";

  return (
    <div className="container">
      <Card title={<h3>{titlePrefix} Script</h3>}>
        <Form onSubmit={handleSubmit} layout="vertical" form={form}>
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
                notFoundContent={isFetchingData ? <Spin size="small" /> : "No Data"}
              >
                {users.map((user: APIUser) => (
                  <Option key={user.id} value={user.id}>
                    {`${user.lastName}, ${user.firstName} (${user.email})`}
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

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(ScriptCreateView));
