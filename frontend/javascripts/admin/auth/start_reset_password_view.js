// @flow
import React from "react";
import { withRouter } from "react-router-dom";
import { Form, Icon, Input, Button, Col, Row } from "antd";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
import type { RouterHistory } from "react-router-dom";

const FormItem = Form.Item;

type Props = {
  history: RouterHistory,
};

function StartResetPasswordView({ history }: Props) {
  const [form] = Form.useForm();

  const handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    form.validateFields((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/auth/startResetPassword", { data: formValues }).then(
          () => {
            Toast.success(messages["auth.reset_email_notification"]);
            history.push("/");
          },
        );
      }
    });
  };

  const { getFieldDecorator } = form;

  return (
    <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
      <Col span={8}>
        <h3>Reset Password</h3>
        <Form onSubmit={handleSubmit} form={form}>
          <FormItem>
            {getFieldDecorator("email", {
              rules: [
                {
                  required: true,
                  type: "email",
                  message: messages["auth.registration_email_input"],
                },
              ],
            })(
              <Input prefix={<Icon type="mail" style={{ fontSize: 13 }} />} placeholder="Email" />,
            )}
          </FormItem>
          <FormItem>
            <Button type="primary" htmlType="submit" style={{ width: "100%" }}>
              Send Reset Email
            </Button>
          </FormItem>
        </Form>
      </Col>
    </Row>
  );
}

export default withRouter(StartResetPasswordView);
