import { LockOutlined } from "@ant-design/icons";
import { Alert, Button, Descriptions, Form, Input, List, Space } from "antd";
import Request from "libs/request";
import Toast from "libs/toast";
import messages from "messages";
import { useState } from "react";
import { type RouteComponentProps, withRouter } from "react-router-dom";
import { logoutUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/store";
import { AccountSettingsTitle } from "./account_profile_view";
const FormItem = Form.Item;
const { Password } = Input;

type Props = {
  history: RouteComponentProps["history"];
};

const MIN_PASSWORD_LENGTH = 8;

function AccountPasswordView({ history }: Props) {
  const [form] = Form.useForm();
  const [isResetPasswordVisible, setResetPasswordVisible] = useState(false);

  function onFinish(formValues: Record<string, any>) {
    Request.sendJSONReceiveJSON("/api/auth/changePassword", {
      data: formValues,
    })
      .then(async () => {
        Toast.success(messages["auth.reset_pw_confirmation"]);
        await Request.receiveJSON("/api/auth/logout");
        history.push("/auth/login");
        Store.dispatch(logoutUserAction());
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
      <>
        <Space.Compact>
          <Input.Password visibilityToggle={false} disabled value="******************" />
          <Button type="primary" onClick={handleResetPassword}>
            Reset Password
          </Button>
        </Space.Compact>
      </>
    );
  }

  function handleResetPassword() {
    setResetPasswordVisible(true);
  }

  const passwordItems = [
    {
      label: "Password",
      children: getPasswordComponent(),
    },
  ];

  const passKeyList = [
    {
      name: "passkey1",
      details: "2024-05-01",
    },
    {
      name: "passkey2",
      details: "2025-05-01",
    },
  ];

  return (
    <div>
      <AccountSettingsTitle title="Password" description="Manage and update your password" />
      <Descriptions
        column={2}
        layout="vertical"
        colon={false}
        items={passwordItems}
        style={{ marginBottom: "3rem" }}
      />

      <AccountSettingsTitle title="Passkeys" description="Login passwordless with Passkeys" />
      <List
        className="demo-loadmore-list"
        itemLayout="horizontal"
        dataSource={passKeyList}
        renderItem={(item) => (
          <List.Item actions={[<a key="list-delete">Delete</a>]}>
            <List.Item.Meta title={item.name} description={item.details} />
          </List.Item>
        )}
      />
    </div>
  );
}

export default withRouter<RouteComponentProps, any>(AccountPasswordView);
