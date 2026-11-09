import AdminPage from "admin/admin_page";
import { createScript, getScript, getTeamManagerOrAdminUsers, updateScript } from "admin/rest_api";
import { Button, Col, Form, Input, Row, Select, theme } from "antd";
import { useApi, useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import type { APIUser } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";

const FormItem = Form.Item;

function ScriptCreateView() {
  const { scriptId } = useParams();
  const { token } = theme.useToken();

  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [form] = Form.useForm();

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

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  const onFinish = async (formValues) => {
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
          <Row gutter={token.paddingMD}>
            <Col xs={24} md={12}>
              <FormItem
                name="name"
                label="Script Name"
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
              </FormItem>
            </Col>
          </Row>

          <FormItem
            name="gist"
            label="Gist URL"
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
            <Input />
          </FormItem>

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
