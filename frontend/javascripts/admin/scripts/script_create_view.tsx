import AdminPage from "admin/admin_page";
import { createScript, getScript, getTeamManagerOrAdminUsers, updateScript } from "admin/rest_api";
import { Button, Col, Form, Input, Row, Select, theme } from "antd";
import { FormItemWithDescription } from "dashboard/dataset/helper_components";
import { useApi, useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import type { APIScriptCreator, APIUser } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";

const FormItem = Form.Item;

function ScriptCreateView() {
  const { scriptId } = useParams();
  const { token } = theme.useToken();

  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [form] = Form.useForm<APIScriptCreator>();

  const { data: users = [], isLoading: isFetchingData } = useApi({
    queryKey: ["teamManagerOrAdminUsers"],
    queryFn: () => getTeamManagerOrAdminUsers(),
    select: (fetchedUsers) => fetchedUsers.filter((user) => user.isActive),
    refetchOnWindowFocus: false,
  });

  const { data: script } = useQueryWithErrorHandling({
    queryKey: ["scriptForEditing", scriptId],
    queryFn: () => getScript(scriptId as string),
    enabled: scriptId != null,
    // Always load the script freshly when opening the form and never refetch it
    // in the background, so that the user's edits are not overwritten.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    meta: { persist: false },
  });

  // Populate the form with the defaults (or the script once it is loaded).
  useEffect(() => {
    if (scriptId != null && script == null) {
      return;
    }
    const defaultValues = {
      owner: script ? script.owner.id : activeUser.id,
    };
    const defaultFormValues = Object.assign({}, script, defaultValues);
    form.setFieldsValue(defaultFormValues);
  }, [form, scriptId, script, activeUser.id]);

  const onFinish = async (formValues: APIScriptCreator) => {
    if (scriptId) {
      await updateScript(scriptId, formValues);
    } else {
      await createScript(formValues);
    }

    navigate("/scripts");
  };

  const titlePrefix = scriptId ? "Update" : "Create";
  return (
    <AdminPage
      title={`${titlePrefix} Script`}
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/scripts.html"
      description="Create or update reusable frontend scripts and assign ownership."
      contentMaxWidth={800}
    >
      <div
        style={{
          padding: token.paddingLG,
        }}
      >
        <Form onFinish={onFinish} layout="vertical" form={form}>
          <Row gutter={token.paddingMD} align="bottom">
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name="name"
                label="Script Name"
                description="Shown when selecting a script for a task."
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                  {
                    min: 3,
                  },
                ]}
              >
                <Input autoFocus />
              </FormItemWithDescription>
            </Col>
            <Col xs={24} md={12}>
              <FormItemWithDescription
                name="owner"
                label="Owner"
                description="Only the owner can edit or delete this script."
                hasFeedback
                rules={[
                  {
                    required: true,
                  },
                ]}
              >
                <Select
                  showSearch={{ optionFilterProp: "label" }}
                  placeholder="Select a User"
                  style={{
                    width: "100%",
                  }}
                  loading={isFetchingData}
                  options={users.map((user: APIUser) => ({
                    value: user.id,
                    label: `${user.lastName}, ${user.firstName} (${user.email})`,
                  }))}
                />
              </FormItemWithDescription>
            </Col>
          </Row>

          <FormItemWithDescription
            name="gist"
            label="Gist URL"
            description={
              <>
                A public{" "}
                <a href="https://gist.github.com/" target="_blank" rel="noopener noreferrer">
                  GitHub Gist
                </a>
                . Its first file runs when annotators open a task that uses this script.
              </>
            }
            hasFeedback
            rules={[
              {
                required: true,
              },
              {
                type: "url",
              },
            ]}
          >
            <Input placeholder="https://gist.github.com/<user>/<id>" />
          </FormItemWithDescription>

          <FormItem>
            <Button type="primary" htmlType="submit">
              {titlePrefix} Script
            </Button>
          </FormItem>
        </Form>
      </div>
    </AdminPage>
  );
}

export default ScriptCreateView;
