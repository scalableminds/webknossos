import { MailOutlined } from "@ant-design/icons";
import { Button, Card, Col, Form, Input, Row } from "antd";
import Request from "libs/request";
import Toast from "libs/toast";
import messages from "messages";
import { Link, useNavigate } from "react-router-dom";
const FormItem = Form.Item;

function StartResetPasswordView() {
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const onFinish = (formValues: Record<string, any>) => {
    Request.sendJSONReceiveJSON("/api/auth/startResetPassword", {
      data: formValues,
    }).then(() => {
      Toast.success(messages["auth.reset_email_notification"]);
      navigate("/");
    });
  };

  return (
    <Row className="login-view" justify="center" align="middle">
      <Col>
        <Card className="login-content">
          <h3>Reset Password</h3>
          <Form onFinish={onFinish} form={form}>
            <FormItem
              name="email"
              rules={[
                {
                  required: true,
                  type: "email",
                  message: messages["auth.registration_email_input"],
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
                placeholder="Email"
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
                Send Reset Email
              </Button>
            </FormItem>
          </Form>
          <Link to="/auth/login">Back to Login</Link>
        </Card>
      </Col>
    </Row>
  );
}

export default StartResetPasswordView;
