import React from "react";
import { RouteComponentProps, withRouter } from "react-router-dom";
import { Form, Input, Button, Col, Row, Alert } from "antd";
import { LockOutlined } from "@ant-design/icons";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
import { logoutUserAction } from "oxalis/model/actions/user_actions";
import Store from "oxalis/store";
const FormItem = Form.Item;
const { Password } = Input;

type Props = {
  history: RouteComponentProps["history"];
};

const MIN_PASSWORD_LENGTH = 8;

function ChangePasswordView({ history }: Props) {
  const [form] = Form.useForm();

  function onFinish(formValues: Record<string, any>) {
    Request.sendJSONReceiveJSON("/api/auth/changePassword", {
      data: formValues,
    }).then(async () => {
      Toast.success(messages["auth.reset_pw_confirmation"]);
      await Request.receiveJSON("/api/auth/logout");
      history.push("/auth/login");
      Store.dispatch(logoutUserAction());
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

  return (
    <Row
      justify="center"
      align="middle"
      style={{
        padding: 50,
      }}
    >
      <Col span={8}>
        <h3>Change Password</h3>
        <Alert
          type="info"
          message={messages["auth.reset_logout"]}
          showIcon
          style={{
            marginBottom: 24,
          }}
        />
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
          <FormItem>
            <Button
              type="primary"
              htmlType="submit"
              style={{
                width: "100%",
              }}
            >
              Change Password
            </Button>
          </FormItem>
        </Form>
      </Col>
    </Row>
  );
}

export default withRouter<RouteComponentProps, any>(ChangePasswordView);
