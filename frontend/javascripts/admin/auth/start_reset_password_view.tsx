import React from "react";
import { RouteComponentProps, withRouter } from "react-router-dom";
import { Form, Input, Button, Col, Row } from "antd";
import { MailOutlined } from "@ant-design/icons";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
// @ts-expect-error ts-migrate(2305) FIXME: Module '"react-router-dom"' has no exported member... Remove this comment to see the full error message
import type { RouterHistory } from "react-router-dom";
const FormItem = Form.Item;
type Props = {
  history: RouterHistory;
};

function StartResetPasswordView({ history }: Props) {
  const [form] = Form.useForm();

  const onFinish = (formValues: Record<string, any>) => {
    Request.sendJSONReceiveJSON("/api/auth/startResetPassword", {
      data: formValues,
    }).then(() => {
      Toast.success(messages["auth.reset_email_notification"]);
      history.push("/");
    });
  };

  return (
    <Row
      // @ts-expect-error ts-migrate(2322) FIXME: Type '{ children: Element; type: string; justify: ... Remove this comment to see the full error message
      type="flex"
      justify="center"
      style={{
        padding: 50,
      }}
      align="middle"
    >
      <Col span={8}>
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
      </Col>
    </Row>
  );
}

export default withRouter<RouteComponentProps & Props, any>(StartResetPasswordView);
