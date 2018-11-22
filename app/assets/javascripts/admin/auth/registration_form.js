// @flow
import { Form, Input, Button, Row, Col, Icon, Select, Checkbox } from "antd";
import { Link } from "react-router-dom";
import React from "react";

import type { APIOrganization } from "admin/api_flow_types";
import { loginUser, getOrganizations } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Request from "libs/request";
import Store from "oxalis/throttled_store";
import messages from "messages";

const FormItem = Form.Item;
const { Option } = Select;

type Props = {|
  form: Object,
  onRegistered: () => void,
  confirmLabel?: string,
  createOrganization?: boolean,
  organizationName?: ?string,
  hidePrivacyStatement?: boolean,
  tryAutoLogin?: boolean,
  onOrganizationNameNotFound?: () => void,
|};

type State = {
  confirmDirty: boolean,
  organizations: Array<APIOrganization>,
};

class RegistrationView extends React.PureComponent<Props, State> {
  state = {
    confirmDirty: false,
    organizations: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    if (this.props.createOrganization) {
      // Since we are creating a new organization, we don't need to fetch existing organizations
      return;
    }

    this.setState({ organizations: await getOrganizations() });
    this.validateOrganizationName();
  }

  validateOrganizationName() {
    if (!this.props.organizationName) {
      return;
    }
    if (
      this.state.organizations.find(org => org.name === this.props.organizationName) == null &&
      this.props.onOrganizationNameNotFound
    ) {
      this.props.onOrganizationNameNotFound();
    }
  }

  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFieldsAndScroll(async (err: ?Object, formValues: Object) => {
      if (err) {
        return;
      }
      await Request.sendJSONReceiveJSON(
        this.props.createOrganization != null
          ? "/api/auth/createOrganizationWithAdmin"
          : "/api/auth/register",
        { data: formValues },
      );
      if (this.props.tryAutoLogin) {
        const user = await loginUser({
          email: formValues.email,
          password: formValues.password.password1,
        });
        Store.dispatch(setActiveUserAction(user));
      }
      this.props.onRegistered();
    });
  };

  handleConfirmBlur = (e: SyntheticInputEvent<>) => {
    const { value } = e.target;
    this.setState(prevState => ({ confirmDirty: prevState.confirmDirty || !!value }));
  };

  checkPassword = (rule, value, callback) => {
    const { form } = this.props;
    if (value && value !== form.getFieldValue("password.password1")) {
      callback(messages["auth.registration_password_missmatch"]);
    } else {
      callback();
    }
  };

  checkConfirm = (rule, value, callback) => {
    const { form } = this.props;
    if (value && this.state.confirmDirty) {
      form.validateFields(["confirm"], { force: true });
    }
    callback();
  };

  getOrganizationFormField() {
    const { getFieldDecorator } = this.props.form;
    if (this.props.createOrganization || this.props.organizationName) {
      if (!this.props.organizationName) {
        throw new Error("When createOrganization is set, organizationName must be passed as well.");
      }
      // The user is either
      // - creating a complete new organization or
      // - the organization is specified via the URL
      // Thus, the organization field is hidden.
      return (
        <FormItem style={{ display: "none" }}>
          {getFieldDecorator("organization", { initialValue: this.props.organizationName })(
            <Input type="text" />,
          )}
        </FormItem>
      );
    }

    return (
      <FormItem hasFeedback>
        {getFieldDecorator("organization", {
          rules: [
            {
              required: true,
              message: messages["auth.registration_org_input"],
            },
          ],
        })(
          <Select placeholder="Organization">
            {this.state.organizations.map(organization => (
              <Option value={organization.name} key={organization.name}>
                {organization.displayName}
              </Option>
            ))}
          </Select>,
        )}
      </FormItem>
    );
  }

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <Form onSubmit={this.handleSubmit}>
        {this.getOrganizationFormField()}
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
                    validator: this.checkConfirm,
                  },
                ],
              })(
                <Input
                  type="password"
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
                    validator: this.checkPassword,
                  },
                ],
              })(
                <Input
                  type="password"
                  onBlur={this.handleConfirmBlur}
                  prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                  placeholder="Confirm Password"
                />,
              )}
            </FormItem>
          </Col>
        </Row>
        {this.props.hidePrivacyStatement ? null : (
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
                <Link to="/privacy">privacy statement</Link>.
              </Checkbox>,
            )}
          </FormItem>
        )}
        <FormItem>
          <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
            {this.props.confirmLabel || "Register"}
          </Button>
        </FormItem>
      </Form>
    );
  }
}

export default Form.create()(RegistrationView);
