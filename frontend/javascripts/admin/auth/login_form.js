// @flow
import { Button, Form, Icon, Input } from "antd";
import { Link } from "react-router-dom";
import React from "react";

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
};

function LoginForm({ layout, form, onLoggedIn, hideFooter }: Props) {
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

  return (
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
          <Link to="/auth/register" style={linkStyle}>
            Register Now
          </Link>
          <Link to="/auth/resetPassword" style={Object.assign({}, linkStyle, resetStyle)}>
            Forgot Password
          </Link>
        </FormItem>
      )}
    </Form>
  );
}

export default Form.create({ fieldNameProp: "name" })(LoginForm);
