// @flow
import React from "react";
import { Link, withRouter } from "react-router-dom";
import { Form, Input, Button, Row, Col, Icon, Card, Select } from "antd";
import messages from "messages";
import Request from "libs/request";
import Toast from "libs/toast";
import { getOrganizations } from "admin/admin_rest_api";
import type { APIOrganizationType } from "admin/api_flow_types";
import type { RouterHistory } from "react-router-dom";

const FormItem = Form.Item;
const Option = Select.Option;

type Props = {
  form: Object,
  history: RouterHistory,
};

type State = {
  confirmDirty: boolean,
  organizations: Array<APIOrganizationType>,
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
    const organizations = await getOrganizations();

    this.setState({ organizations });
  }

  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFieldsAndScroll((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/auth/register", { data: formValues }).then(() => {
          Toast.success(messages["auth.account_created"]);
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

    const organizationComponents = (
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
                {organization.name}
              </Option>
            ))}
          </Select>,
        )}
      </FormItem>
    );

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <h3>Registration</h3>
          <Card style={{ marginBottom: 24 }}>
            Not a member of the listed organizations?<br /> Contact{" "}
            <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a> to get more
            information about how to get to use webKnossos.
          </Card>
          <Form onSubmit={this.handleSubmit}>
            {organizationComponents}
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
              })(
                <Input
                  prefix={<Icon type="mail" style={{ fontSize: 13 }} />}
                  placeholder="Email"
                />,
              )}
            </FormItem>
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
                />,
              )}
            </FormItem>
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
            <FormItem>
              <Button type="primary" htmlType="submit" style={{ width: "100%" }}>
                Register
              </Button>
              <Link to="/auth/login">Already have an account? Login instead.</Link>
            </FormItem>
          </Form>
        </Col>
      </Row>
    );
  }
}

export default withRouter(Form.create()(RegistrationView));
