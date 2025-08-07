import { MailOutlined, SaveOutlined } from "@ant-design/icons";
import { SettingsCard } from "admin/account/helpers/settings_card";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { updateOrganization } from "admin/rest_api";
import { getUsers } from "admin/rest_api";
import { Button, Col, Form, Input, Row } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { Store } from "viewer/singletons";

const FormItem = Form.Item;

type FormValues = {
  displayName: string;
  newUserMailingList: string;
};

export function OrganizationNotificationsView() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const [form] = Form.useForm<FormValues>();
  const [ownerEmail, setOwnerEmail] = useState<string>("");

  useEffect(() => {
    async function fetchOwnerEmail() {
      const users = await getUsers();
      const owner = users.find(
        (user) => user.isOrganizationOwner && user.organization === organization.id,
      );
      if (owner) {
        setOwnerEmail(owner.email);
      }
    }
    fetchOwnerEmail();
  }, [organization.id]);

  async function onFinish(formValues: FormValues) {
    const updatedOrganization = await updateOrganization(
      organization.id,
      organization.name,
      formValues.newUserMailingList,
    );
    Store.dispatch(setActiveOrganizationAction(updatedOrganization));
    Toast.success("Notification settings were saved successfully.");
  }

  function getNewUserNotificationsSettings() {
    return (
      <Form
        form={form}
        onFinish={onFinish}
        style={{ marginTop: 10 }}
        layout="inline"
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
            content={ownerEmail}
          />
        </Col>
        <Col span={12}>
          <SettingsCard
            title="AI Job Completion"
            tooltip="Get notified when a background conversion or AI job is completed."
            content="Users are notified individually."
          />
        </Col>
        <Col span={12}>
          <SettingsCard
            title="New User Signup"
            tooltip="Get notified when a new user signs up to your organization."
            content={getNewUserNotificationsSettings()}
          />
        </Col>
      </Row>
    </>
  );
}
