// @flow
import { Form, Input, Button, Row, Col, Checkbox } from "antd";
import { UserOutlined, LockOutlined, MailOutlined } from "@ant-design/icons";
import React, { useRef, memo } from "react";

import { loginUser } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Request from "libs/request";
import Store from "oxalis/throttled_store";
import messages from "messages";

const FormItem = Form.Item;
const { Password } = Input;

type Props = {|
  onRegistered: (isUserLoggedIn: true) => void,
|};

function generateOrganizationName() {
  let output = "";
  for (let i = 0; i < 8; i++) {
    output += Math.floor(Math.random() * 255)
      .toString(16)
      .padStart(2, "0");
  }
  return output;
}
function SpotlightRegistrationForm(props: Props) {
  const [form] = Form.useForm();
  const organizationName = useRef(generateOrganizationName());

  async function onFinish(formValues: Object) {
    await Request.sendJSONReceiveJSON("/api/auth/createOrganizationWithAdmin", {
      data: {
        ...formValues,
        password: {
          password1: formValues.password.password1,
          password2: formValues.password.password1,
        },
        organization: organizationName.current,
        organizationDisplayName: `${formValues.firstName} ${formValues.lastName} Lab`,
      },
    });

    const user = await loginUser({
      email: formValues.email,
      password: formValues.password.password1,
    });
    Store.dispatch(setActiveUserAction(user));

    props.onRegistered(true);
  }

  return (
    <Form onFinish={onFinish} form={form}>
      <Row gutter={8}>
        <Col span={12}>
          <FormItem
            hasFeedback
            name="firstName"
            rules={[{ required: true, message: messages["auth.registration_firstName_input"] }]}
          >
            <Input prefix={<UserOutlined style={{ fontSize: 13 }} />} placeholder="First Name" />
          </FormItem>
        </Col>

        <Col span={12}>
          <FormItem
            hasFeedback
            name="lastName"
            rules={[{ required: true, message: messages["auth.registration_lastName_input"] }]}
          >
            <Input prefix={<UserOutlined style={{ fontSize: 13 }} />} placeholder="Last Name" />
          </FormItem>
        </Col>
      </Row>
      <FormItem
        hasFeedback
        name="email"
        rules={[
          { type: "email", message: messages["auth.registration_email_invalid"] },
          { required: true, message: messages["auth.registration_email_input"] },
        ]}
      >
        <Input prefix={<MailOutlined style={{ fontSize: 13 }} />} placeholder="Email" />
      </FormItem>
      <FormItem
        hasFeedback
        name={["password", "password1"]}
        rules={[
          { required: true, message: messages["auth.registration_password_input"] },
          { min: 8, message: messages["auth.registration_password_length"] },
        ]}
      >
        <Password prefix={<LockOutlined style={{ fontSize: 13 }} />} placeholder="Password" />
      </FormItem>

      <FormItem
        name="privacy_check"
        valuePropName="checked"
        rules={[
          {
            validator: (_, value) =>
              value
                ? Promise.resolve()
                : Promise.reject(new Error(messages["auth.privacy_check_required"])),
          },
        ]}
      >
        <Checkbox>
          I agree to storage and processing of my personal data as described in the{" "}
          <a target="_blank" href="/privacy" rel="noopener noreferrer">
            privacy statement
          </a>
          .
        </Checkbox>
      </FormItem>
      <FormItem style={{ marginBottom: 10 }}>
        <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
          Create Free Account
        </Button>
      </FormItem>
    </Form>
  );
}
// $FlowIgnore[missing-annot]
export default memo(SpotlightRegistrationForm);
