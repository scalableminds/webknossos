// @flow
import { Form, Input, Button, Row, Col, Icon, Checkbox } from "antd";
import { Link } from "react-router-dom";
import React from "react";

import { loginUser } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Request from "libs/request";
import Store from "oxalis/throttled_store";
import messages from "messages";

const FormItem = Form.Item;
const { Password } = Input;

type Props = {|
  form: Object,
  onRegistered: () => void,
|};

type State = {
  organizationName: string,
};

function generateOrganizationName() {
  let output = "";
  for (let i = 0; i < 8; i++) {
    output += Math.floor(Math.random() * 255)
      .toString(16)
      .padStart(2, "0");
  }
  return output;
}

class RegistrationForm extends React.PureComponent<Props, State> {
  state = {
    organizationName: generateOrganizationName(),
  };

  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFieldsAndScroll(async (err: ?Object, formValues: Object) => {
      if (err) {
        return;
      }
      await Request.sendJSONReceiveJSON("/api/auth/createOrganizationWithAdmin", {
        data: {
          ...formValues,
          password: {
            password1: formValues.password.password1,
            password2: formValues.password.password1,
          },
          organization: this.state.organizationName,
        },
      });

      const user = await loginUser({
        email: formValues.email,
        password: formValues.password.password1,
      });
      Store.dispatch(setActiveUserAction(user));

      this.props.onRegistered();
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <Form onSubmit={this.handleSubmit}>
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
            ],
          })(
            <Password
              prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
              placeholder="Password"
            />,
          )}
        </FormItem>

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
        <FormItem style={{ marginBottom: 10 }}>
          <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
            Create Free Account
          </Button>
        </FormItem>
        <p style={{ textAlign: "center" }}>
          <Link to="/auth/login">Log in to existing account</Link>
        </p>
      </Form>
    );
  }
}

export default Form.create()(RegistrationForm);
