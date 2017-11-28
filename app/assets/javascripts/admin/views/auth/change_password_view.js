// @flow
import React from "react";
import { withRouter } from "react-router-dom";
import { Form, Icon, Input, Button, Col, Row, Alert } from "antd";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
import type { ReactRouterHistoryType } from "react_router";

const FormItem = Form.Item;

type Props = {
  form: Object,
  history: ReactRouterHistoryType,
};

type State = {
  confirmDirty: boolean,
};

class ChangePasswordView extends React.PureComponent<Props, State> {
  state = {
    confirmDirty: false,
  };

  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFieldsAndScroll((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/auth/changePassword", { data: formValues }).then(() => {
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

  checkConfirm = (rule, value, callback) => {
    const form = this.props.form;
    if (value && this.state.confirmDirty) {
      form.validateFields(["confirm"], { force: true });
    }
    callback();
  };

  checkPassword = (rule, value, callback) => {
    const form = this.props.form;
    if (value && value !== form.getFieldValue("password.password1")) {
      callback(messages["auth.registration_password_missmatch"]);
    } else {
      callback();
    }
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Change Password</h3>
          <Alert
            type="info"
            message={messages["auth.reset_logout"]}
            showIcon
            style={{ marginBottom: 24 }}
          />
          <Form onSubmit={this.handleSubmit}>
            <FormItem>
              {getFieldDecorator("oldPassword", {
                rules: [
                  {
                    required: true,
                    message: messages["auth.reset_old_password"],
                  },
                ],
              })(<Input type="password" placeholder="Old Password" />)}
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
                Change Password
              </Button>
            </FormItem>
          </Form>
        </Col>
      </Row>
    );
  }
}

export default withRouter(Form.create()(ChangePasswordView));
