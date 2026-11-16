import AdminPage from "admin/admin_page";
import {
  createProject,
  getEditableTeams,
  getProject,
  getUsers,
  updateProject,
} from "admin/rest_api";
import { Button, Col, Form, Input, InputNumber, Row, Select, theme } from "antd";
import {
  CheckboxWithDescription,
  FormItemWithDescription,
} from "dashboard/dataset/helper_components";
import { useApi, useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import type { APIProjectCreator, APITeam, APIUser } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";

const FormItem = Form.Item;

function ProjectCreateView() {
  const { projectId } = useParams();
  const { token } = theme.useToken();

  const [form] = Form.useForm<APIProjectCreator>();
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

  const handleSubmit = async (formValues: APIProjectCreator) => {
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
          <FormItemWithDescription
            name="name"
            label="Project Name"
            description="Letters, digits, hyphens and underscores only. Can't be changed later."
            hasFeedback
            rules={[
              {
                required: true,
              },
              {
                pattern: /^[a-zA-Z0-9_-]*$/,
                message: "The project name must not contain whitespace or special characters.",
              },
              {
                min: 3,
                message: "The project name must be at least 3 characters long.",
              },
            ]}
          >
            <Input autoFocus disabled={isEditMode} />
          </FormItemWithDescription>
          <Row gutter={token.paddingMD} align="bottom">
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name="team"
                label="Team"
                description="Only members of this team can get tasks from this project."
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
              </FormItemWithDescription>
            </Col>
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name="owner"
                label="Owner"
                description="Gets an email when an annotator exceeds the time limit."
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
              </FormItemWithDescription>
            </Col>
          </Row>

          <Row gutter={token.paddingMD} align="bottom">
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name="priority"
                label="Priority"
                description="Tasks from projects with a higher priority are assigned first."
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
              </FormItemWithDescription>
            </Col>
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name="expectedTime"
                label="Time Limit per Task Instance"
                description="Exceeding it emails the owner. It doesn't stop the annotator."
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
                <InputNumber style={fullWidth} min={1} suffix="minutes" />
              </FormItemWithDescription>
            </Col>
          </Row>

          <FormItem name="isBlacklistedFromReport" valuePropName="checked">
            <CheckboxWithDescription description="Hides the project from the Project Progress report, e.g. for test or archived projects.">
              Hide from Project Progress
            </CheckboxWithDescription>
          </FormItem>

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
