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
  form: Object,
  history: RouterHistory,
};

type State = {
  confirmDirty: boolean,
};

class FinishResetPasswordView extends React.PureComponent<Props, State> {
  state = {
    confirmDirty: false,
  };

  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFieldsAndScroll((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/auth/resetPassword", { data: formValues }).then(() => {
          Toast.success(messages["auth.reset_pw_confirmation"]);
          this.props.history.push("/auth/login");
        });
      }
    });
  };

  handleConfirmBlur = (e: SyntheticInputEvent<>) => {
    const value = e.target.value;
    this.setState({ confirmDirty: this.state.confirmDirty || !!value });
  };

  checkPassword = (rule, value, callback) => {
    const form = this.props.form;
    if (value && value !== form.getFieldValue("password.password1")) {
      callback(messages["auth.registration_password_missmatch"]);
    } else {
      callback();
    }
  };

  checkConfirm = (rule, value, callback) => {
    const form = this.props.form;
    if (value && this.state.confirmDirty) {
      form.validateFields(["confirm"], { force: true });
    }
    callback();
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Reset Password</h3>
          <Form onSubmit={this.handleSubmit}>
            <FormItem>
              {getFieldDecorator("token", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.reset_token"],
                  },
                ],
              })(<Input type="text" placeholder="Token" />)}
            </FormItem>
            <FormItem hasFeedback>
              {getFieldDecorator("password.password1", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.reset_new_password"],
                  },
                  {
                    min: 8,
                    message: messages["auth.registration_password_length"],
                  },
                  {
                    validator: this.checkConfirm,
                  },
                ],
              })(
                <Input
                  type="password"
                  prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                  placeholder="New Password"
                />,
              )}
            </FormItem>
            <FormItem hasFeedback>
              {getFieldDecorator("password.password2", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.reset_new_password2"],
                  },
                  {
                    min: 8,
                    message: messages["auth.registration_password_length"],
                  },
                  {
                    validator: this.checkPassword,
                  },
                ],
              })(
                <Input
                  type="password"
                  onBlur={this.handleConfirmBlur}
                  prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                  placeholder="Confirm New Password"
                />,
              )}
            </FormItem>
            <FormItem>
              <Button type="primary" htmlType="submit" style={{ width: "100%" }}>
                Reset Password
              </Button>
            </FormItem>
          </Form>
        </Col>
      </Row>
    );
  }
}

export default withRouter(Form.create()(FinishResetPasswordView));
