// @flow
import { Alert, Button, Form, Icon, Input } from "antd";
import { Link } from "react-router-dom";
import React from "react";

import { getIsInIframe } from "libs/utils";
import { loginUser } from "admin/admin_rest_api";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import Store from "oxalis/store";
import messages from "messages";

const FormItem = Form.Item;

type Props = {
  layout: "horizontal" | "vertical" | "inline",
  form: Object,
  onLoggedIn?: () => void,
  hideFooter?: boolean,
  style?: Object,
};

function LoginForm({ layout, form, onLoggedIn, hideFooter, style }: Props) {
  const { getFieldDecorator } = form;
  const resetStyle = layout === "horizontal" ? { float: "right" } : null;
  const linkStyle = layout === "inline" ? { paddingLeft: 10 } : null;

  const handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    form.validateFields(async (err: ?Object, formValues: Object) => {
      if (!err) {
        const user = await loginUser(formValues);
        Store.dispatch(setActiveUserAction(user));
        if (onLoggedIn) onLoggedIn();
      }
    });
  };

  const iframeWarning = getIsInIframe() ? (
    <Alert
      type="warning"
      message={
        <span>
          Authentication within an iFrame probably does not work due to third-party cookies being
          forbidden in most browsers. Please{" "}
          <a href={window.location} target="_blank" rel="noopener noreferrer">
            open webKnossos
          </a>{" "}
          outside of an iFrame to log in.
        </span>
      }
      style={{ marginBottom: 12 }}
    />
  ) : null;

  return (
    <div style={style}>
      {iframeWarning}
      <Form onSubmit={handleSubmit} layout={layout}>
        <FormItem>
          {getFieldDecorator("email", {
            rules: [
              {
                required: true,
                type: "email",
                message: messages["auth.registration_email_input"],
              },
            ],
          })(<Input prefix={<Icon type="mail" style={{ fontSize: 13 }} />} placeholder="Email" />)}
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
        {hideFooter ? null : (
          <FormItem style={{ marginBottom: 4 }}>
            <div style={{ display: "flex" }}>
              <Link to="/auth/register" style={{ ...linkStyle, marginRight: 10, flexGrow: 1 }}>
                Register Now
              </Link>
              <Link to="/auth/resetPassword" style={Object.assign({}, linkStyle, resetStyle)}>
                Forgot Password
              </Link>
            </div>
          </FormItem>
        )}
      </Form>
    </div>
  );
}

export default Form.create({ fieldNameProp: "name" })(LoginForm);
