// @flow
import React from "react";
import { Form, Icon, Input, Button, Col, Row } from "antd";
import Request from "libs/request";

const FormItem = Form.Item;

type Props = {
  form: Object,
};

class LoginView extends React.PureComponent<Props> {
  handleSubmit = (event: SyntheticInputEvent<>) => {
    event.preventDefault();

    this.props.form.validateFields((err: ?Object, formValues: Object) => {
      if (!err) {
        Request.sendJSONReceiveJSON("/api/login", { data: formValues });
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={8}>
          <Form onSubmit={this.handleSubmit}>
            <FormItem>
              {getFieldDecorator("userName", {
                rules: [{ required: true, message: "Please input your username!" }],
              })(
                <Input
                  prefix={<Icon type="user" style={{ fontSize: 13 }} />}
                  placeholder="Username"
                />,
              )}
            </FormItem>
            <FormItem>
              {getFieldDecorator("password", {
                rules: [{ required: true, message: "Please input your Password!" }],
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
              <a href="/register">Register Now!</a>
              <a style={{ float: "right" }} href="/reset">
                Forgot Password
              </a>
            </FormItem>
          </Form>
        </Col>
      </Row>
    );
  }
}

export default Form.create()(LoginView);
