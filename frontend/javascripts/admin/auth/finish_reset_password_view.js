// @flow
import React, { useState } from "react";
import { withRouter } from "react-router-dom";
import { Form, Input, Button, Col, Row } from "antd";
import { LockOutlined } from "@ant-design/icons";
import Request from "libs/request";
import messages from "messages";
import Toast from "libs/toast";
import type { RouterHistory } from "react-router-dom";

const FormItem = Form.Item;
const { Password } = Input;

type Props = {
  history: RouterHistory,
  resetToken: string,
};

function FinishResetPasswordView(props: Props) {
  const [form] = Form.useForm();
  const [confirmDirty, setConfirmDirty] = useState<boolean>(false);

  const handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();
    form.validateFieldsAndScroll((err: ?Object, formValues: Object) => {
      if (!err) {
        const data = formValues;
        if (props.resetToken === "") {
          Toast.error(messages["auth.reset_token_not_supplied"]);
          return;
        }
        data.token = props.resetToken;
        Request.sendJSONReceiveJSON("/api/auth/resetPassword", { data }).then(() => {
          Toast.success(messages["auth.reset_pw_confirmation"]);
          props.history.push("/auth/login");
        });
      }
    });
  };

  const handleConfirmBlur = (e: SyntheticInputEvent<>) => {
    const { value } = e.target;
    setConfirmDirty(confirmDirty || !!value);
  };

  const checkPassword = (rule, value, callback) => {
    if (value && value !== form.getFieldValue("password.password1")) {
      callback(messages["auth.registration_password_mismatch"]);
    } else {
      callback();
    }
  };

  const checkConfirm = (rule, value, callback) => {
    if (value && confirmDirty) {
      form.validateFields(["confirm"], { force: true });
    }
    callback();
  };

  // TODO: get rid of this
  const { getFieldDecorator } = props.form;

  return (
    <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
      <Col span={8}>
        <h3>Reset Password</h3>
        <Form onSubmit={handleSubmit} form={form}>
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
                  validator: checkConfirm,
                },
              ],
            })(
              <Password
                prefix={<LockOutlined style={{ fontSize: 13 }} />}
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
                  validator: checkPassword,
                },
              ],
            })(
              <Password
                onBlur={handleConfirmBlur}
                prefix={<LockOutlined style={{ fontSize: 13 }} />}
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

export default withRouter(FinishResetPasswordView);
