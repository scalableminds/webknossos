import { createScript, getScript, getTeamManagerOrAdminUsers, updateScript } from "admin/rest_api";
import { Button, Card, Form, Input, Select } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { APIUser } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { useWkSelector } from "libs/react_hooks";

const FormItem = Form.Item;

function ScriptCreateView() {
  const { scriptId } = useParams();

  const navigate = useNavigate();
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [users, setUsers] = useState<APIUser[]>([]);
  const [isFetchingData, setIsFetchingData] = useState<boolean>(false);
  const [form] = Form.useForm();
  useEffect(() => {
    fetchData();
    applyDefaults();
  }, []);

  async function fetchData() {
    setIsFetchingData(true);
    const fetchedUsers = await getTeamManagerOrAdminUsers();
    const onlyActiveUsers = fetchedUsers.filter((user) => user.isActive);
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
    <div className="container">
      <Card title={<h3>{titlePrefix} Script</h3>}>
        <Form onFinish={onFinish} layout="vertical" form={form}>
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

export default ScriptCreateView;
