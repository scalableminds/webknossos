import { MailOutlined, SaveOutlined } from "@ant-design/icons";
import { AccountSettingsTitle } from "admin/account/account_profile_view";
import { updateOrganization } from "admin/rest_api";
import { Button, Form, Input } from "antd";
import Toast from "libs/toast";
import type { APIOrganization } from "types/api_types";

const FormItem = Form.Item;

type FormValues = {
  displayName: string;
  newUserMailingList: string;
};

export function OrganizationNotificationsView({ organization }: { organization: APIOrganization }) {
  const [form] = Form.useForm<FormValues>();

  async function onFinish(formValues: FormValues) {
    await updateOrganization(organization.id, organization.name, formValues.newUserMailingList);
    Toast.success("Notification settings were saved successfully.");
  }

  const OrgaNameRegexPattern = /^[A-Za-z0-9\\-_\\. ß]+$/;

  return (
    <>
      <AccountSettingsTitle title="Settings" description="Manage your organization settings." />
      <Form
        form={form}
        onFinish={onFinish}
        layout="vertical"
        initialValues={{
          newUserMailingList: organization.newUserMailingList,
        }}
      >
        <FormItem
          label="Email Address for New-User Notifications"
          name="newUserMailingList"
          rules={[
            {
              required: false,
              type: "email",
              message: "Please provide a valid email address.",
            },
          ]}
        >
          <Input
            prefix={
              <MailOutlined
                style={{
                  fontSize: 13,
                }}
              />
            }
            placeholder="mail@example.com"
          />
        </FormItem>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
          Save
        </Button>
      </Form>
    </>
  );
}
