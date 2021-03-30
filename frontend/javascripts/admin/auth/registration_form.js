// @flow
import { Form, Input, Button, Row, Col, Icon, Checkbox } from "antd";
import React, { useState } from "react";

import { type APIOrganization } from "types/api_flow_types";
import { loginUser } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Request from "libs/request";
import Store from "oxalis/throttled_store";
import messages from "messages";
import { setHasOrganizationsAction } from "oxalis/model/actions/ui_actions";

const FormItem = Form.Item;
const { Password } = Input;

type Props = {|
  onRegistered: boolean => void,
  confirmLabel?: string,
  organizationNameToCreate?: string,
  targetOrganization?: APIOrganization,
  inviteToken?: ?string,
  hidePrivacyStatement?: boolean,
  tryAutoLogin?: boolean,
|};

function RegistrationForm(props: Props) {
  const [confirmDirty, setConfirmDirty] = useState<boolean>(false);
  const [form] = Form.useForm();

  const handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    form.validateFieldsAndScroll(async (err: ?Object, formValues: Object) => {
      if (err) {
        return;
      }
      await Request.sendJSONReceiveJSON(
        props.organizationNameToCreate != null
          ? "/api/auth/createOrganizationWithAdmin"
          : "/api/auth/register",
        { data: formValues },
      );

      Store.dispatch(setHasOrganizationsAction(true));

      const { targetOrganization } = props;
      const autoVerified = targetOrganization != null ? targetOrganization.enableAutoVerify : false;

      const tryAutoLogin = props.tryAutoLogin || props.inviteToken != null || autoVerified;
      if (tryAutoLogin) {
        const user = await loginUser({
          email: formValues.email,
          password: formValues.password.password1,
        });
        Store.dispatch(setActiveUserAction(user));
      }
      props.onRegistered(tryAutoLogin);
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

  const getHiddenFields = () => {
    // TODO: migrate this
    const { getFieldDecorator } = form;
    const { inviteToken, targetOrganization, organizationNameToCreate } = props;

    const tokenField =
      inviteToken == null ? null : (
        <React.Fragment>
          <FormItem style={{ display: "none" }}>
            {getFieldDecorator("inviteToken", { initialValue: inviteToken })(<Input type="text" />)}
          </FormItem>
        </React.Fragment>
      );

    // targetOrganizationName is not empty if the user is
    // either creating a complete new organization OR
    // the user is about to join an existing organization
    const targetOrganizationName =
      organizationNameToCreate ||
      (targetOrganization != null ? targetOrganization.name : null) ||
      "";

    const organizationFields = (
      <>
        <FormItem style={{ display: "none" }}>
          {getFieldDecorator("organization", { initialValue: targetOrganizationName })(
            <Input type="text" />,
          )}
        </FormItem>
        <FormItem style={{ display: "none" }}>
          {getFieldDecorator("organizationDisplayName", {
            initialValue: targetOrganizationName,
          })(<Input type="text" />)}
        </FormItem>
      </>
    );

    return (
      <>
        {tokenField}
        {organizationFields}
      </>
    );
  };

  // TODO: migrate this.
  const { getFieldDecorator } = form;

  return (
    <Form onSubmit={handleSubmit} form={form}>
      {getHiddenFields()}
      <Row gutter={8}>
        <Col span={12}>
          <FormItem hasFeedback>
            {getFieldDecorator("firstName", {
              rules: [
                {
                  required: true,
                  message: messages["auth.registration_firstName_input"],
                },
              ],
            })(
              <Input
                prefix={<Icon type="user" style={{ fontSize: 13 }} />}
                placeholder="First Name"
                autoFocus
              />,
            )}
          </FormItem>
        </Col>

        <Col span={12}>
          <FormItem hasFeedback>
            {getFieldDecorator("lastName", {
              rules: [
                {
                  required: true,
                  message: messages["auth.registration_lastName_input"],
                },
              ],
            })(
              <Input
                prefix={<Icon type="user" style={{ fontSize: 13 }} />}
                placeholder="Last Name"
              />,
            )}
          </FormItem>
        </Col>
      </Row>
      <FormItem hasFeedback>
        {getFieldDecorator("email", {
          rules: [
            {
              type: "email",
              message: messages["auth.registration_email_invalid"],
            },
            {
              required: true,
              message: messages["auth.registration_email_input"],
            },
          ],
        })(<Input prefix={<Icon type="mail" style={{ fontSize: 13 }} />} placeholder="Email" />)}
      </FormItem>
      <Row gutter={8}>
        <Col span={12}>
          <FormItem hasFeedback>
            {getFieldDecorator("password.password1", {
              rules: [
                {
                  required: true,
                  message: messages["auth.registration_password_input"],
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
                prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                placeholder="Password"
              />,
            )}
          </FormItem>
        </Col>
        <Col span={12}>
          <FormItem hasFeedback>
            {getFieldDecorator("password.password2", {
              rules: [
                {
                  required: true,
                  message: messages["auth.registration_password_confirm"],
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
                prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                placeholder="Confirm Password"
              />,
            )}
          </FormItem>
        </Col>
      </Row>
      {props.hidePrivacyStatement ? null : (
        <FormItem>
          {getFieldDecorator("privacy_check", {
            valuePropName: "checked",
            initialValue: false,
            rules: [
              {
                validator: (rule, value, callback) => {
                  if (value) {
                    callback();
                  } else {
                    callback(new Error());
                  }
                },
                message: messages["auth.privacy_check_required"],
              },
            ],
          })(
            <Checkbox>
              I agree to storage and processing of my personal data as described in the{" "}
              <a target="_blank" href="/privacy" rel="noopener noreferrer">
                privacy statement
              </a>
              .
            </Checkbox>,
          )}
        </FormItem>
      )}
      <FormItem>
        <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
          {props.confirmLabel || "Register"}
        </Button>
      </FormItem>
    </Form>
  );
}

export default RegistrationForm;
