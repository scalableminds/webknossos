import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { logoutUser, updateUser } from "admin/rest_api";
import { Alert, Button, Col, Form, Input, Row } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { logoutUserAction } from "viewer/model/actions/user_actions";
import { Store } from "viewer/singletons";

import { useNavigate } from "react-router-dom";
import { handleResendVerificationEmail } from "./verify_email_view";

const FormItem = Form.Item;

const NEW_EMAIL_FIELD_KEY = "newEmail";
const CONFIRM_NEW_EMAIL_FIELD_KEY = "confirmNewEmail";
const PASSWORD_FIELD_KEY = "password";

function ChangeEmailView() {
  const [form] = Form.useForm();
  const activeUser = useWkSelector((state) => state.activeUser);
  useNavigate();

  async function changeEmail(newEmail: string, password: string) {
    const newUser = Object.assign({}, activeUser, {
      email: newEmail,
      password,
    });
    return updateUser(newUser);
  }

  function onFinish() {
    const newEmail = form.getFieldValue(NEW_EMAIL_FIELD_KEY);
    const password = form.getFieldValue(PASSWORD_FIELD_KEY);
    changeEmail(newEmail, password)
      .then(async () => {
        handleResendVerificationEmail();
        Toast.success("Email address changed successfully. You will be logged out.");
        await logoutUser();
        Store.dispatch(logoutUserAction());
        window.location.href = "/auth/login";
      })
      .catch((error) => {
        const errorMsg = "An unexpected error occurred while changing the email address.";
        Toast.error(errorMsg);
        console.error(errorMsg, error);
      });
  }

  function checkEmailsAreMatching(value: string, otherEmailFieldKey: string[]) {
    const otherFieldValue = form.getFieldValue(otherEmailFieldKey);

    if (value && otherFieldValue) {
      if (value !== otherFieldValue) {
        return Promise.reject(new Error("Email addresses do not match"));
      } else if (form.getFieldError(otherEmailFieldKey).length > 0) {
        form.validateFields([otherEmailFieldKey]);
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
        <h3>Change Email</h3>
        <Alert
          type="info"
          message="You will be logged out after changing your email address."
          showIcon
          style={{
            marginBottom: 24,
          }}
        />
        <Form onFinish={onFinish} form={form}>
          <FormItem
            name={PASSWORD_FIELD_KEY}
            rules={[
              {
                required: true,
                message: "Please enter your password for verification",
              },
            ]}
          >
            <Input.Password
              prefix={
                <LockOutlined
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="Your Password"
            />
          </FormItem>
          <FormItem
            hasFeedback
            name={NEW_EMAIL_FIELD_KEY}
            rules={[
              {
                required: true,
                message: "Please enter your new email address",
              },
              {
                type: "email",
                message: "Please enter a valid email address",
              },
              {
                validator: (_, value: string) =>
                  checkEmailsAreMatching(value, [CONFIRM_NEW_EMAIL_FIELD_KEY]),
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
              placeholder="New Email Address"
            />
          </FormItem>
          <FormItem
            hasFeedback
            name={CONFIRM_NEW_EMAIL_FIELD_KEY}
            rules={[
              {
                required: true,
                message: "Please confirm your new email address",
              },
              {
                type: "email",
                message: "Please enter a valid email address",
              },
              {
                validator: (_, value: string) =>
                  checkEmailsAreMatching(value, [NEW_EMAIL_FIELD_KEY]),
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
              placeholder="Confirm New Email Address"
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
              Change Email
            </Button>
          </FormItem>
        </Form>
      </Col>
    </Row>
  );
}

export default ChangeEmailView;
