// @flow
import React from "react";
import { Link } from "react-router-dom";
import { Form, Input, Button, Row, Col, Icon, Select, Checkbox } from "antd";
import messages from "messages";
import Request from "libs/request";
import Toast from "libs/toast";
import { getOrganizationNames } from "admin/admin_rest_api";

const FormItem = Form.Item;
const { Option } = Select;

type Props = {
  form: Object,
  onRegistered: () => void,
  confirmLabel?: string,
  organizationId?: string,
  hidePrivacyStatement?: boolean,
};

type State = {
  confirmDirty: boolean,
  organizations: Array<string>,
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
    if (this.props.organizationId == null) {
      const organizations = await getOrganizationNames();
      this.setState({ organizations });
    }
  }

  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFieldsAndScroll((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/auth/register", { data: formValues }).then(() => {
          Toast.success(messages["auth.account_created"]);
          this.props.onRegistered();
        });
      }
    });
  };

  handleConfirmBlur = (e: SyntheticInputEvent<>) => {
    const { value } = e.target;
    this.setState({ confirmDirty: this.state.confirmDirty || !!value });
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

  render() {
    const { getFieldDecorator } = this.props.form;

    const organizationComponents =
      this.props.organizationId == null ? (
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
                <Option value={organization} key={organization}>
                  {organization}
                </Option>
              ))}
            </Select>,
          )}
        </FormItem>
      ) : null;

    return (
      <Form onSubmit={this.handleSubmit}>
        {organizationComponents}
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
                  autofocus
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
