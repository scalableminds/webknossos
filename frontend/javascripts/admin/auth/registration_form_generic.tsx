import { LockOutlined, MailOutlined, UserOutlined } from "@ant-design/icons";
import { getTermsOfService } from "admin/api/terms_of_service";
import { loginUser } from "admin/rest_api";
import { Button, Checkbox, Col, Form, Input, Row } from "antd";
import { useFetch } from "libs/react_helpers";
import Request from "libs/request";
import messages from "messages";
import React from "react";
import type { APIOrganization } from "types/api_types";
import { setActiveOrganizationAction } from "viewer/model/actions/organization_actions";
import { setHasOrganizationsAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/throttled_store";
import { TOSCheckFormItem } from "./tos_check_form_item";

const FormItem = Form.Item;
const { Password } = Input;

type Props = {
  onRegistered: (arg0: boolean) => void;
  confirmLabel?: string;
  organizationIdToCreate?: string;
  targetOrganization?: APIOrganization;
  inviteToken?: string | null | undefined;
  hidePrivacyStatement?: boolean;
  tryAutoLogin?: boolean;
};

function RegistrationFormGeneric(props: Props) {
  const [form] = Form.useForm();

  const terms = useFetch(getTermsOfService, null, []);

  const onFinish = async (formValues: Record<string, any>) => {
    await Request.sendJSONReceiveJSON(
      props.organizationIdToCreate != null
        ? "/api/auth/createOrganizationWithAdmin"
        : "/api/auth/register",
      {
        data: {
          ...formValues,
          firstName: formValues.firstName.trim(),
          lastName: formValues.lastName.trim(),
        },
      },
    );
    Store.dispatch(setHasOrganizationsAction(true));
    const { targetOrganization } = props;
    const autoVerified = targetOrganization != null ? targetOrganization.enableAutoVerify : false;
    const tryAutoLogin = props.tryAutoLogin || props.inviteToken != null || autoVerified;

    if (tryAutoLogin) {
      const [user, organization] = await loginUser({
        email: formValues.email,
        password: formValues.password.password1,
      });
      Store.dispatch(setActiveUserAction(user));
      Store.dispatch(setActiveOrganizationAction(organization));
    }

    props.onRegistered(tryAutoLogin);
  };

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'value' implicitly has an 'any' type.
  function checkPasswordsAreMatching(value, otherPasswordFieldKey) {
    const otherFieldValue = form.getFieldValue(otherPasswordFieldKey);

    if (value && otherFieldValue) {
      if (value !== otherFieldValue) {
        return Promise.reject(new Error(messages["auth.registration_password_mismatch"]));
      } else if (form.getFieldError(otherPasswordFieldKey).length > 0) {
        // If the other password field still has errors, revalidate it.
        form.validateFields([otherPasswordFieldKey]);
      }
    }

    return Promise.resolve();
  }

  const getHiddenFields = () => {
    const { inviteToken } = props;
    const tokenField =
      inviteToken == null ? null : (
        <FormItem
          style={{
            display: "none",
          }}
          name="inviteToken"
        >
          <Input type="text" />
        </FormItem>
      );
    const organizationFields = (
      <React.Fragment>
        <FormItem
          style={{
            display: "none",
          }}
          name="organization"
        >
          <Input type="text" />
        </FormItem>
        <FormItem
          style={{
            display: "none",
          }}
          name="organizationName"
        >
          <Input type="text" />
        </FormItem>
      </React.Fragment>
    );
    return (
      <React.Fragment>
        {tokenField}
        {organizationFields}
      </React.Fragment>
    );
  };

  // targetOrganizationId is not empty if the user is
  // either creating a complete new organization OR
  // the user is about to join an existing organization
  const { inviteToken, targetOrganization, organizationIdToCreate, hidePrivacyStatement } = props;
  const targetOrganizationId =
    organizationIdToCreate || (targetOrganization != null ? targetOrganization.id : null) || "";
  const defaultValues: Record<string, any> = {
    organization: targetOrganizationId,
    organizationName: targetOrganizationId,
  };

  if (inviteToken) {
    defaultValues.inviteToken = inviteToken;
  }

  if (!hidePrivacyStatement) {
    defaultValues.privacy_check = false;
  }

  return (
    <Form onFinish={onFinish} form={form} initialValues={defaultValues}>
      {getHiddenFields()}
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
              autoFocus
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
      <Row gutter={8}>
        <Col span={12}>
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
              {
                validator: (_, value) =>
                  checkPasswordsAreMatching(value, ["password", "password2"]),
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
        </Col>
        <Col span={12}>
          <FormItem
            hasFeedback
            name={["password", "password2"]}
            rules={[
              {
                required: true,
                message: messages["auth.registration_password_confirm"],
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
              prefix={
                <LockOutlined
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              placeholder="Confirm Password"
            />
          </FormItem>
        </Col>
      </Row>
      <div className="registration-form-checkboxes">
        {props.hidePrivacyStatement ? null : (
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
        )}
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
          {props.confirmLabel || "Register"}
        </Button>
      </FormItem>
    </Form>
  );
}

export default RegistrationFormGeneric;
