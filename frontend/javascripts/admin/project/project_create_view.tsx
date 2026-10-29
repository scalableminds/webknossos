import AdminPage from "admin/admin_page";
import {
  createProject,
  getEditableTeams,
  getProject,
  getUsers,
  updateProject,
} from "admin/rest_api";
import { Button, Checkbox, Col, Form, Input, InputNumber, Row, Select, theme } from "antd";
import { useApi, useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import type { APITeam, APIUser } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;

function ProjectCreateView() {
  const { projectId } = useParams();
  const { token } = theme.useToken();

  const [form] = Form.useForm();
  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));

  const { data: users = [], isLoading: isLoadingUsers } = useApi({
    queryKey: ["users"],
    queryFn: () => getUsers(),
    refetchOnWindowFocus: false,
  });
  const { data: teams = [], isLoading: isLoadingTeams } = useQueryWithErrorHandling({
    queryKey: ["editableTeams"],
    queryFn: getEditableTeams,
    refetchOnWindowFocus: false,
  });
  const isFetchingData = isLoadingUsers || isLoadingTeams;

  const { data: project } = useQueryWithErrorHandling({
    queryKey: ["projectForEditing", projectId],
    queryFn: () => getProject(projectId as string),
    enabled: projectId != null,
    // Always load the project freshly when opening the form and never refetch it
    // in the background, so that the user's edits are not overwritten.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    meta: { persist: false },
  });

  // Populate the form with the defaults (or the project once it is loaded).
  useEffect(() => {
    if (projectId != null && project == null) {
      return;
    }
    const defaultValues = {
      priority: 100,
      expectedTime: 90,
      isBlacklistedFromReport: false,
    };
    const defaultFormValues = Object.assign({}, defaultValues, project, {
      owner: project ? project.owner.id : activeUser.id,
    });
    form.setFieldsValue(defaultFormValues);
  }, [form, projectId, project, activeUser.id]);

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
  const projectName = Form.useWatch("name", form);
  const title =
    isEditMode && projectId ? `Update Project ${projectName || projectId}` : "Create Project";
  const fullWidth = {
    width: "100%",
  };
  return (
    <AdminPage
      title={title}
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/projects.html"
      description="Create or update project metadata and assignment settings."
      contentMaxWidth={800}
    >
      <div
        style={{
          padding: token.paddingLG,
        }}
      >
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
          <Row gutter={token.paddingMD}>
            <Col xs={24} md={12}>
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
                  showSearch={{ optionFilterProp: "label" }}
                  placeholder="Select a Team"
                  style={fullWidth}
                  disabled={isEditMode}
                  loading={isFetchingData}
                  options={teams.map((team: APITeam) => ({
                    label: team.name,
                    value: team.id,
                  }))}
                />
              </FormItem>
            </Col>
            <Col xs={24} md={12}>
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
                  placeholder="Select a User"
                  showSearch={{ optionFilterProp: "label" }}
                  style={fullWidth}
                  disabled={isEditMode}
                  loading={isFetchingData}
                  options={users.map((user: APIUser) => ({
                    label: `${user.lastName}, ${user.firstName} (${user.email})`,
                    value: user.id,
                  }))}
                />
              </FormItem>
            </Col>
          </Row>

          <Row gutter={token.paddingMD}>
            <Col xs={24} md={12}>
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
            </Col>
            <Col xs={24} md={12}>
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
            </Col>
          </Row>

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
      </div>
    </AdminPage>
  );
}

export default ProjectCreateView;
