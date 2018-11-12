// @flow
import { Form, Icon, Input, Button, Col, Row } from "antd";
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import React from "react";

import { loginUser } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Store from "oxalis/throttled_store";
import * as Utils from "libs/utils";
import messages from "messages";
import window from "libs/window";

const FormItem = Form.Item;

type Props = {
  form: Object,
  layout: "horizontal" | "inline",
  history: RouterHistory,
  redirect?: string,
};

class LoginView extends React.PureComponent<Props> {
  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFields(async (err: ?Object, formValues: Object) => {
      if (!err) {
        const user = await loginUser(formValues);
        if (!Utils.hasUrlParam("redirectPage")) {
          Store.dispatch(setActiveUserAction(user));
          if (this.props.redirect) {
            // Use "redirect" prop for internal redirects, e.g. for SecuredRoutes
            this.props.history.push(this.props.redirect);
          } else {
            this.props.history.push("/dashboard");
          }
        } else {
          // Use "redirectPage" URL parameter to cause a full page reload and redirecting to external sites
          // e.g. Discuss
          window.location.replace(Utils.getUrlParamValue("redirectPage"));
        }
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const rowStyle = this.props.layout === "horizontal" ? { padding: 50 } : null;
    const resetStyle = this.props.layout === "horizontal" ? { float: "right" } : null;
    const linkStyle = this.props.layout === "inline" ? { paddingLeft: 10 } : null;

    return (
      <Row type="flex" justify="center" style={rowStyle} align="middle">
        <Col span={this.props.layout === "inline" ? 24 : 8}>
          {this.props.layout === "horizontal" ? <h3>Login</h3> : null}
          <Form onSubmit={this.handleSubmit} layout={this.props.layout}>
            <FormItem>
              {getFieldDecorator("email", {
                rules: [
                  {
                    required: true,
                    type: "email",
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
            <FormItem>
              {getFieldDecorator("password", {
                rules: [{ required: true, message: messages["auth.registration_password_input"] }],
              })(
                <Input
                  prefix={<Icon type="lock" style={{ fontSize: 13 }} />}
                  type="password"
                  placeholder="Password"
                />,
              )}
            </FormItem>
            <FormItem>
              <Button type="primary" htmlType="submit" style={{ width: "100%" }}>
                Log in
              </Button>
            </FormItem>
            <FormItem>
              <Link to="/auth/register" style={linkStyle}>
                Register Now!
              </Link>
              <Link to="/auth/resetPassword" style={Object.assign({}, linkStyle, resetStyle)}>
                Forgot Password
              </Link>
            </FormItem>
          </Form>
        </Col>
      </Row>
    );
  }
}

export default withRouter(Form.create({ fieldNameProp: "name" })(LoginView));
