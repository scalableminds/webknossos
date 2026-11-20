import { MailOutlined, RobotOutlined, SaveOutlined, UserAddOutlined } from "@ant-design/icons";
import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { Button, Col, Form, Input, Row } from "antd";
import Toast from "libs/toast";
import {
  useActiveOrganization,
  useCanManageOrganization,
  useOrganizationUsers,
  useUpdateActiveOrganization,
} from "./organization_hooks";

const FormItem = Form.Item;

type FormValues = {
  displayName: string;
  newUserMailingList: string;
};

export function OrganizationNotificationsView() {
  const organization = useActiveOrganization();
  const updateActiveOrganization = useUpdateActiveOrganization();
  const canManageOrganization = useCanManageOrganization();
  const [form] = Form.useForm<FormValues>();
  const { data: users = [] } = useOrganizationUsers();
  const ownerEmail =
    users.find((user) => user.isOrganizationOwner && user.organization === organization.id)
      ?.email ?? "";

  async function onFinish(formValues: FormValues) {
    await updateActiveOrganization({ newUserMailingList: formValues.newUserMailingList });
    Toast.success("Notification settings were saved successfully.");
  }

  function getNewUserNotificationsSettings() {
    return (
      <Form
        form={form}
        onFinish={onFinish}
        layout="inline"
        disabled={!canManageOrganization}
        initialValues={{
          newUserMailingList: organization.newUserMailingList,
        }}
      >
        <FormItem
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
            placeholder="email@example.com"
            style={{ minWidth: 250 }}
          />
        </FormItem>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
          Save
        </Button>
      </Form>
    );
  }

  return (
    <>
      <SettingsTitle
        title="Notification Settings"
        description="Manage your organization's email notification settings."
      />
      <Row gutter={[16, 16]}>
        <Col span={12}>
          <SettingsCard
            title="WEBKNOSSOS Plan & Subscription"
            tooltip="Get notified when your WK subscription is about to expire or reach user and storage limits."
            icon={<MailOutlined />}
            content={ownerEmail}
          />
        </Col>
        <Col span={12}>
          <SettingsCard
            title="AI Job Completion"
            tooltip="Get notified when a background conversion or AI job is completed."
            icon={<RobotOutlined />}
            content="Users are notified individually."
          />
        </Col>
        <Col span={12}>
          <SettingsCard
            title="New User Signup"
            tooltip="Get notified when a new user signs up to your organization."
            icon={<UserAddOutlined />}
            content="Mailing list"
          >
            {getNewUserNotificationsSettings()}
          </SettingsCard>
        </Col>
      </Row>
    </>
  );
}
