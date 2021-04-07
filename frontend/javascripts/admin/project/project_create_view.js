// @flow
import { Form, Input, Select, Button, Card, InputNumber, Checkbox, Spin } from "antd";
import React, { useState, useEffect } from "react";
import { useHistory } from "react-router-dom";
import { useSelector } from "react-redux";

import type { APIUser, APITeam } from "types/api_flow_types";
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

type OwnProps = {|
  projectName?: ?string,
|};
type StateProps = {||};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {|
  ...Props,
|};

function ProjectCreateView({ projectName }: PropsWithRouter) {
  const [teams, setTeams] = useState<Array<APITeam>>([]);
  const [users, setUsers] = useState<Array<APIUser>>([]);
  const [isFetchingData, setIsFetchingData] = useState<boolean>(false);
  const [form] = Form.useForm();
  const history = useHistory();
  const activeUser = useSelector(state => enforceActiveUser(state.activeUser));

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

  const handleSubmit = async formValues => {
    if (projectName) {
      await updateProject(projectName, formValues);
    } else {
      await createProject(formValues);
    }
    history.push("/projects");
  };

  const isEditMode = projectName != null;
  const title = isEditMode && projectName ? `Update Project ${projectName}` : "Create Project";
  const fullWidth = { width: "100%" };

  return (
    <div className="row container project-administration">
      <Card title={<h3>{title}</h3>}>
        <Form onFinish={handleSubmit} layout="vertical" form={form}>
          <FormItem
            name="name"
            label="Project Name"
            hasFeedback
            rules={[
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
            ]}
          >
            <Input autoFocus disabled={isEditMode} />
          </FormItem>
          <FormItem name="team" label="Team" hasFeedback rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="Select a Team"
              optionFilterProp="children"
              style={fullWidth}
              disabled={isEditMode}
              notFoundContent={isFetchingData ? <Spin size="small" /> : "No Data"}
              options={teams.map((team: APITeam) => ({
                label: team.name,
                value: team.id,
              }))}
            />
          </FormItem>

          <FormItem name="owner" label="Owner" hasFeedback rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder="Select a User"
              optionFilterProp="children"
              style={fullWidth}
              disabled={isEditMode}
              notFoundContent={isFetchingData ? <Spin size="small" /> : "No Data"}
              options={users.map((user: APIUser) => ({
                label: `${user.lastName}, ${user.firstName} (${user.email})`,
                value: user.id,
              }))}
            />
          </FormItem>
          <FormItem
            name="priority"
            label="Priority"
            hasFeedback
            rules={[{ required: true }, { type: "number" }]}
          >
            <InputNumber style={fullWidth} />
          </FormItem>

          <FormItem
            name="expectedTime"
            label="Time Limit (Minutes)"
            hasFeedback
            rules={[{ required: true }, { type: "number", min: 1 }]}
          >
            <InputNumber style={fullWidth} />
          </FormItem>

          <FormItemWithInfo
            name="isBlacklistedFromReport"
            label="Visibility in Project Progress View"
            info="If checked, the project will not be listed in the project progress view."
            valuePropName="checked"
          >
            <Checkbox>Do not show in Project Progress View</Checkbox>
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

export default ProjectCreateView;
