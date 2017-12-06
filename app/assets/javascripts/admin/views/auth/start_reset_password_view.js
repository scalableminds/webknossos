// @flow
import React from "react";
import { withRouter } from "react-router-dom";
import { Form, Icon, Input, Button, Col, Row } from "antd";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
import type { ReactRouterHistoryType } from "react_router";

const FormItem = Form.Item;

type Props = {
  form: Object,
  history: ReactRouterHistoryType,
};

class StartResetPasswordView extends React.PureComponent<Props> {
  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFields((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/auth/startResetPassword", { data: formValues }).then(
          () => {
            Toast.success(messages["auth.reset_email_notification"]);
            this.props.history.push("/api/auth/finishResetPassword");
          },
        );
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Reset Password</h3>
          <Form onSubmit={this.handleSubmit}>
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
                <Input
                  prefix={<Icon type="mail" style={{ fontSize: 13 }} />}
                  placeholder="Email"
                />,
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
}

export default withRouter(Form.create()(StartResetPasswordView));
