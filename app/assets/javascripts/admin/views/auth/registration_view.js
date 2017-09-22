// @flow

import React from "react";
import { Form, Input, Button } from "antd";
import messages from "messages";

const FormItem = Form.Item;

type Props = {
  form: Object,
};

type State = {
  confirmDirty: boolean,
};

class RegistrationView extends React.PureComponent<Props, State> {
  state = {
    confirmDirty: false,
  };

  handleSubmit = e => {
    e.preventDefault();

    this.props.form.validateFieldsAndScroll((err, values) => {
      if (!err) {
        console.log("Received values of form: ", values);
      }
    });
  };

  handleConfirmBlur = (e: SyntheticInputEvent<>) => {
    const value = e.target.value;
    this.setState({ confirmDirty: this.state.confirmDirty || !!value });
  };

  checkPassword = (rule, value, callback) => {
    const form = this.props.form;
    if (value && value !== form.getFieldValue("password")) {
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

    const formItemLayout = {
      labelCol: {
        xs: { span: 24 },
        sm: { span: 6 },
      },
      wrapperCol: {
        xs: { span: 24 },
        sm: { span: 14 },
      },
    };
    const tailFormItemLayout = {
      wrapperCol: {
        xs: {
          span: 24,
          offset: 0,
        },
        sm: {
          span: 14,
          offset: 6,
        },
      },
    };

    return (
      <Form onSubmit={this.handleSubmit}>
        <FormItem {...formItemLayout} label="E-mail" hasFeedback>
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
          })(<Input />)}
        </FormItem>
        <FormItem {...formItemLayout} label="Password" hasFeedback>
          {getFieldDecorator("password", {
            rules: [
              {
                required: true,
                message: messages["auth.registration_password_input"],
              },
              {
                validator: this.checkConfirm,
              },
            ],
          })(<Input type="password" />)}
        </FormItem>
        <FormItem {...formItemLayout} label="Confirm Password" hasFeedback>
          {getFieldDecorator("confirm", {
            rules: [
              {
                required: true,
                message: messages["auth.registration_password_confirm"],
              },
              {
                validator: this.checkPassword,
              },
            ],
          })(<Input type="password" onBlur={this.handleConfirmBlur} />)}
        </FormItem>
        <FormItem {...tailFormItemLayout}>
          <Button type="primary" htmlType="submit">
            Register
          </Button>
        </FormItem>
      </Form>
    );
  }
}

export default Form.create()(RegistrationView);
