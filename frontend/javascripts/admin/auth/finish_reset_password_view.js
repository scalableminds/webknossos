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
  const [confirmDirty, setConfirmDirty] = useState<boolean>(false);
  const [form] = Form.useForm();

  function onFinish(formValues: Object) {
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

  const handleConfirmBlur = (e: SyntheticInputEvent<>) => {
    const { value } = e.target;
    setConfirmDirty(confirmDirty || !!value);
  };

  function checkPasswordsAreMatching(value, otherPasswordFieldKey) {
    const otherFieldValue = form.getFieldValue(otherPasswordFieldKey);
    if (value && otherFieldValue && value !== otherFieldValue) {
      return Promise.reject(new Error(messages["auth.registration_password_mismatch"]));
    }
    return Promise.resolve();
  }

  return (
    <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
      <Col span={8}>
        <h3>Reset Password</h3>
        <Form onFinish={onFinish} form={form}>
          <FormItem
            hasFeedback
            name={["password", "password1"]}
            rules={[
              {
                required: true,
                message: messages["auth.reset_new_password"],
              },
              {
                min: 8,
                message: messages["auth.registration_password_length"],
              },
              {
                validator: (_, value) =>
                  checkPasswordsAreMatching(value, ["password", "password2"]),
              },
            ]}
          >
            <Password
              prefix={<LockOutlined style={{ fontSize: 13 }} />}
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
                min: 8,
                message: messages["auth.registration_password_length"],
              },
              {
                validator: (_, value) =>
                  checkPasswordsAreMatching(value, ["password", "password1"]),
              },
            ]}
          >
            <Password
              onBlur={handleConfirmBlur}
              prefix={<LockOutlined style={{ fontSize: 13 }} />}
              placeholder="Confirm New Password"
            />
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
