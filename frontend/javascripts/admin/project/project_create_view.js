// @flow
import { Form, Input, Select, Button, Card, InputNumber, Checkbox, Spin } from "antd";
import { type RouterHistory, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import React, { useState, useEffect } from "react";

import type { APIUser, APITeam } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getUsers,
  getEditableTeams,
  createProject,
  getProject,
  updateProject,
} from "admin/admin_rest_api";

import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;
const { Option } = Select;

type OwnProps = {|
  projectName?: ?string,
|};
type StateProps = {|
  activeUser: APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {|
  ...Props,
  history: RouterHistory,
|};

function ProjectCreateView({ history, activeUser, projectName }: PropsWithRouter) {
  const [teams, setTeams] = useState < Array < APITeam >> [];
  const [users, setUsers] = useState < Array < APIUser >> [];
  const [isFetchingData, setIsFetchingData] = useState<boolean>(false);
  const [form] = Form.useForm();

  useEffect(() => {
    fetchData();
    applyDefaults();
  }, []);

  async function fetchData() {
    setIsFetchingData(true);
    const [fetchedUsers, fetchedTeams] = await Promise.all([getUsers(), getEditableTeams()]);
    setUsers(fetchedUsers);
    setTeams(fetchedTeams);
    setIsFetchingData(false);
  }

  async function applyDefaults() {
    const project = projectName ? await getProject(projectName) : null;
    const defaultValues = {
      priority: 100,
      expectedTime: 90,
      isBlacklistedFromReport: false,
    };

    const defaultFormValues = Object.assign({}, defaultValues, project, {
      owner: project ? project.owner.id : activeUser.id,
    });
    form.setFieldsValue(defaultFormValues);
  }

  const handleSubmit = e => {
    e.preventDefault();
    form.validateFields(async (err, formValues) => {
      if (!err) {
        if (projectName) {
          await updateProject(projectName, formValues);
        } else {
          await createProject(formValues);
        }
        history.push("/projects");
      }
    });
  };

  const { getFieldDecorator } = form;
  const isEditMode = projectName != null;
  const title = isEditMode && projectName ? `Update Project ${projectName}` : "Create Project";
  const fullWidth = { width: "100%" };

  return (
    <div className="row container project-administration">
      <Card title={<h3>{title}</h3>}>
        <Form onSubmit={handleSubmit} layout="vertical" from={form}>
          <FormItem label="Project Name" hasFeedback>
            {getFieldDecorator("name", {
              rules: [
                {
                  required: true,
                  pattern: "^[a-zA-Z0-9_-]*$",
                  message: "The project name must not contain whitespace or special characters.",
                },
                {
                  min: 3,
                  required: true,
                  message: "The project name must be at least 3 characters long.",
                },
              ],
            })(<Input autoFocus disabled={isEditMode} />)}
          </FormItem>

          <FormItem label="Team" hasFeedback>
            {getFieldDecorator("team", {
              rules: [{ required: true }],
            })(
              <Select
                showSearch
                placeholder="Select a Team"
                optionFilterProp="children"
                style={fullWidth}
                disabled={isEditMode}
                notFoundContent={isFetchingData ? <Spin size="small" /> : "No Data"}
              >
                {teams.map((team: APITeam) => (
                  <Option key={team.id} value={team.id}>
                    {team.name}
                  </Option>
                ))}
              </Select>,
            )}
          </FormItem>

          <FormItem label="Owner" hasFeedback>
            {getFieldDecorator("owner", {
              rules: [{ required: true }],
            })(
              <Select
                showSearch
                placeholder="Select a User"
                optionFilterProp="children"
                style={fullWidth}
                disabled={isEditMode}
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

          <FormItem label="Priority" hasFeedback>
            {getFieldDecorator("priority", {
              rules: [{ required: true }, { type: "number" }],
            })(<InputNumber style={fullWidth} />)}
          </FormItem>

          <FormItem label="Time Limit (Minutes)" hasFeedback>
            {getFieldDecorator("expectedTime", {
              rules: [{ required: true }, { type: "number", min: 1 }],
            })(<InputNumber style={fullWidth} />)}
          </FormItem>

          <FormItemWithInfo
            label="Visibility in Project Progress View"
            info="If checked, the project will not be listed in the project progress view."
          >
            {getFieldDecorator("isBlacklistedFromReport", { valuePropName: "checked" })(
              <Checkbox>Do not show in Project Progress View</Checkbox>,
            )}
          </FormItemWithInfo>

          <FormItem>
            <Button type="primary" htmlType="submit">
              {title}
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

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(ProjectCreateView));
