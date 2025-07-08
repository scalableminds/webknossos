import { EditOutlined, LockOutlined } from "@ant-design/icons";
import { changePassword, logoutUser } from "admin/rest_api";
import { Alert, Button, Col, Form, Input, Row, Space } from "antd";
import features from "features";
import Toast from "libs/toast";
import messages from "messages";
import { useState } from "react";
import { useHistory } from "react-router-dom";
import { logoutUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/store";
import { SettingsCard } from "./helpers/settings_card";
import { SettingsTitle } from "./helpers/settings_title";
const FormItem = Form.Item;
const { Password } = Input;
import PasskeysView from "../auth/passkeys_view.tsx";

const MIN_PASSWORD_LENGTH = 8;

function AccountPasswordView() {
  const history = useHistory();
  const [form] = Form.useForm();
  const [isResetPasswordVisible, setResetPasswordVisible] = useState(false);

  function onFinish(formValues: Record<string, any>) {
    changePassword(formValues)
      .then(async () => {
        Toast.success(messages["auth.reset_pw_confirmation"]);
        await logoutUser();
        Store.dispatch(logoutUserAction());
        history.push("/auth/login");
      })
      .catch((error) => {
        console.error("Password change failed:", error);
        Toast.error("Failed to change password. Please try again.");
      });
  }

  function checkPasswordsAreMatching(value: string, otherPasswordFieldKey: string[]) {
    const otherFieldValue = form.getFieldValue(otherPasswordFieldKey);

    if (value && otherFieldValue) {
      if (value !== otherFieldValue) {
        return Promise.reject(new Error(messages["auth.registration_password_mismatch"]));
      } else if (form.getFieldError(otherPasswordFieldKey).length > 0) {
        // If the other password field still has errors, revalidate it.
        form.validateFields([otherPasswordFieldKey]);
      }
    }

    return Promise.resolve();
  }

  function getPasswordComponent() {
    return isResetPasswordVisible ? (
      <Form onFinish={onFinish} form={form}>
        <FormItem
          name="oldPassword"
          rules={[
            {
              required: true,
              message: messages["auth.reset_old_password"],
            },
          ]}
        >
          <Password
            prefix={
              <LockOutlined
                style={{
                  fontSize: 13,
                }}
              />
            }
            placeholder="Old Password"
          />
        </FormItem>
        <FormItem
          hasFeedback
          name={["password", "password1"]}
          rules={[
            {
              required: true,
              message: messages["auth.reset_new_password"],
            },
            {
              min: MIN_PASSWORD_LENGTH,
              message: messages["auth.registration_password_length"],
            },
            {
              validator: (_, value: string) =>
                checkPasswordsAreMatching(value, ["password", "password2"]),
            },
          ]}
        >
          <Password
            prefix={
              <LockOutlined
                style={{
                  fontSize: 13,
                }}
              />
            }
            placeholder="New Password"
          />
        </FormItem>
        <FormItem
          hasFeedback
          name={["password", "password2"]}
          rules={[
            {
              required: true,
              message: messages["auth.reset_new_password2"],
            },
            {
              min: MIN_PASSWORD_LENGTH,
              message: messages["auth.registration_password_length"],
            },
            {
              validator: (_, value: string) =>
                checkPasswordsAreMatching(value, ["password", "password1"]),
            },
          ]}
        >
          <Password
            prefix={
              <LockOutlined
                style={{
                  fontSize: 13,
                }}
              />
            }
            placeholder="Confirm New Password"
          />
        </FormItem>
        <Alert
          type="info"
          message={messages["auth.reset_logout"]}
          showIcon
          style={{
            marginBottom: 24,
          }}
        />
        <FormItem>
          <Space>
            <Button onClick={() => setResetPasswordVisible(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit">
              Update Password
            </Button>
          </Space>
        </FormItem>
      </Form>
    ) : (
      "***********"
    );
  }

  function handleResetPassword() {
    setResetPasswordVisible(true);
  }

  const { passkeysEnabled } = features();

  return (
    <div>
      <SettingsTitle title="Password" description="Manage and update your password" />
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <SettingsCard
            title="Password"
            description={getPasswordComponent()}
            action={
              <Button
                type="default"
                shape="circle"
                icon={<EditOutlined />}
                size="small"
                onClick={handleResetPassword}
              />
            }
          />
        </Col>
      </Row>

      {passkeysEnabled && (
        <>
          <SettingsTitle title="Passkeys" description="Login passwordless with Passkeys" />
          <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
            <Col span={12}>
              <SettingsCard title="Passkeys" description={<PasskeysView />} />
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}

export default AccountPasswordView;
