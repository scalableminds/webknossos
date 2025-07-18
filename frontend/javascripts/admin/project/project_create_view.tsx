import {
  createProject,
  getEditableTeams,
  getProject,
  getUsers,
  updateProject,
} from "admin/rest_api";
import { Button, Card, Checkbox, Form, Input, InputNumber, Select } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { APITeam, APIUser } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;

function ProjectCreateView() {
  const { projectId } = useParams();

  const [teams, setTeams] = useState<APITeam[]>([]);
  const [users, setUsers] = useState<APIUser[]>([]);
  const [isFetchingData, setIsFetchingData] = useState<boolean>(false);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
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
    const project = projectId ? await getProject(projectId) : null;
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

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  const handleSubmit = async (formValues) => {
    if (projectId) {
      await updateProject(projectId, formValues);
    } else {
      await createProject(formValues);
    }

    navigate("/projects");
  };

  const isEditMode = projectId != null;
  const projectName = form.getFieldValue("name");
  const title =
    isEditMode && projectId ? `Update Project ${projectName || projectId}` : "Create Project";
  const fullWidth = {
    width: "100%",
  };
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'RegExp | ... Remove this comment to see the full error message
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
          <FormItem
            name="team"
            label="Team"
            hasFeedback
            rules={[
              {
                required: true,
              },
            ]}
          >
            <Select
              showSearch
              placeholder="Select a Team"
              optionFilterProp="label"
              style={fullWidth}
              disabled={isEditMode}
              loading={isFetchingData}
              options={teams.map((team: APITeam) => ({
                label: team.name,
                value: team.id,
              }))}
            />
          </FormItem>

          <FormItem
            name="owner"
            label="Owner"
            hasFeedback
            rules={[
              {
                required: true,
              },
            ]}
          >
            <Select
              showSearch
              placeholder="Select a User"
              optionFilterProp="label"
              style={fullWidth}
              disabled={isEditMode}
              loading={isFetchingData}
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
            rules={[
              {
                required: true,
              },
              {
                type: "number",
              },
            ]}
          >
            <InputNumber style={fullWidth} />
          </FormItem>

          <FormItem
            name="expectedTime"
            label="Time Limit (Minutes)"
            hasFeedback
            rules={[
              {
                required: true,
              },
              {
                type: "number",
                min: 1,
              },
            ]}
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
