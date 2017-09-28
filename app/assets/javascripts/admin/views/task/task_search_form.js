// @flow
import React from "react";
import { Form, Row, Col, Button, Input } from "antd";

type Props = {
  form: Object,
  onChange: Function,
};

const FormItem = Form.Item;

class TaskSearchForm extends React.Component<Props> {
  handleFormSubmit = (event: SyntheticInputEvent<*>) => {
    event.preventDefault();
    debugger;
    this.props.form.validateFields((err, formValues) => {
      console.log("Received values of form: ", formValues);
    });
  };

  handleReset = () => {
    this.props.form.resetFields();
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    return (
      <Form onSubmit={this.handleFormSubmit}>
        <Row gutter={40}>
          <Col span={12}>
            <FormItem {...formItemLayout} label="Task Id">
              {getFieldDecorator("taskId")(<Input />)}
            </FormItem>
          </Col>
          <Col span={12}>
            <FormItem {...formItemLayout} label="Task Type">
              {getFieldDecorator("taskId")(<Input />)}
            </FormItem>
          </Col>
          <Col span={12}>
            <FormItem {...formItemLayout} label="Project">
              {getFieldDecorator("taskId")(<Input />)}
            </FormItem>
          </Col>
          <Col span={12}>
            <FormItem {...formItemLayout} label="User">
              {getFieldDecorator("taskId")(<Input />)}
            </FormItem>
          </Col>
        </Row>
        <Row>
          <Col span={24} style={{ textAlign: "right" }}>
            <Button type="primary" htmlType="submit">
              Search
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={this.handleReset}>
              Clear
            </Button>
          </Col>
        </Row>
      </Form>
    );
  }
}

export default Form.create()(TaskSearchForm);
