import { LockOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { getTermsOfService } from "admin/api/terms_of_service";
import { loginUser } from "admin/rest_api";
import { Button, Checkbox, Col, Form, Input, Row } from "antd";
import { useFetch } from "libs/react_helpers";
import Request from "libs/request";
import messages from "messages";
import { memo, useRef } from "react";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/throttled_store";
import { TOSCheckFormItem } from "./tos_check_form_item";

const FormItem = Form.Item;
const { Password } = Input;

type Props = {
  onRegistered: (isUserLoggedIn: true) => void;
};

function generateOrganizationId() {
  let output = "";

  for (let i = 0; i < 8; i++) {
    output += Math.floor(Math.random() * 255)
      .toString(16)
      .padStart(2, "0");
  }

  return output;
}

function RegistrationFormWKOrg(props: Props) {
  const [form] = Form.useForm();
  const organizationId = useRef(generateOrganizationId());
  const terms = useFetch(getTermsOfService, null, []);

  async function onFinish(formValues: Record<string, any>) {
    await Request.sendJSONReceiveJSON("/api/auth/createOrganizationWithAdmin", {
      data: {
        ...formValues,
        firstName: formValues.firstName.trim(),
        lastName: formValues.lastName.trim(),
        password: {
          password1: formValues.password.password1,
          password2: formValues.password.password1,
        },
        organization: organizationId.current,
        organizationName: `${formValues.firstName.trim()} ${formValues.lastName.trim()} Lab`,
        acceptedTermsOfService: terms?.version,
      },
    });
    const [user, organization] = await loginUser({
      email: formValues.email,
      password: formValues.password.password1,
    });
    Store.dispatch(setActiveUserAction(user));
    Store.dispatch(setActiveOrganizationAction(organization));
    props.onRegistered(true);
  }

  return (
    <Form onFinish={onFinish} form={form}>
      <Row gutter={8}>
        <Col span={12}>
          <FormItem
            hasFeedback
            name="firstName"
            rules={[
              {
                required: true,
                message: messages["auth.registration_firstName_input"],
              },
            ]}
          >
            <Input
              prefix={
                <UserOutlined
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="First Name"
            />
          </FormItem>
        </Col>

        <Col span={12}>
          <FormItem
            hasFeedback
            name="lastName"
            rules={[
              {
                required: true,
                message: messages["auth.registration_lastName_input"],
              },
            ]}
          >
            <Input
              prefix={
                <UserOutlined
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="Last Name"
            />
          </FormItem>
        </Col>
      </Row>
      <FormItem
        hasFeedback
        name="email"
        rules={[
          {
            type: "email",
            message: messages["auth.registration_email_invalid"],
          },
          {
            required: true,
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
      <FormItem
        hasFeedback
        name={["password", "password1"]}
        rules={[
          {
            required: true,
            message: messages["auth.registration_password_input"],
          },
          {
            min: 8,
            message: messages["auth.registration_password_length"],
          },
        ]}
      >
        <Password
          prefix={
            <LockOutlined
              style={{
                fontSize: 13,
              }}
            />
          }
          placeholder="Password"
        />
      </FormItem>
      <div className="registration-form-checkboxes">
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
        <TOSCheckFormItem terms={terms} />
      </div>

      <FormItem>
        <Button
          size="large"
          type="primary"
          htmlType="submit"
          style={{
            width: "100%",
          }}
        >
          Create Free Account
        </Button>
      </FormItem>
    </Form>
  );
}
export default memo(RegistrationFormWKOrg);
