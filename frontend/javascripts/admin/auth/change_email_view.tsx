import { LockOutlined, MailOutlined } from "@ant-design/icons";
import { updateUser } from "admin/rest_api";
import { Alert, Button, Col, Form, Input, Row } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Request from "libs/request";
import Toast from "libs/toast";
import { type RouteComponentProps, withRouter } from "react-router-dom";
const FormItem = Form.Item;

function ChangeEmailView() {
  const [form] = Form.useForm();
  const activeUser = useWkSelector((state) => state.activeUser);

  async function changeEmail(newEmail: string) {
    const newUser = Object.assign({}, activeUser, {
      email: newEmail,
    });
    return updateUser(newUser);
  }

  function onFinish() {
    const newEmail = form.getFieldValue("newEmail");
    changeEmail(newEmail)
      .then(() => {
        Toast.success("Email address changed successfully. You will be logged out.");
        return Request.receiveJSON("/api/auth/logout");
      })
      .then(() => {
        form.resetFields();
        // Redirect to login page after successful email change
        window.location.href = "/auth/login";
      })
      .catch((error) => {
        Toast.error(
          "An unexpected error occurred while changing the email address: " + error.message,
        );
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
            name="password"
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
            name="newEmail"
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
                validator: (_, value: string) => checkEmailsAreMatching(value, ["confirmNewEmail"]),
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
            name="confirmNewEmail"
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
                validator: (_, value: string) => checkEmailsAreMatching(value, ["newEmail"]),
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

export default withRouter<RouteComponentProps, any>(ChangeEmailView);
