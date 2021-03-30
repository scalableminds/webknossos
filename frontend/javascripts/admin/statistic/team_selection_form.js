// @flow
import { Row, Col, Form, Button } from "antd";
import * as React from "react";

import type { APITeam } from "types/api_flow_types";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";

const FormItem = Form.Item;

type Props = {
  value?: ?APITeam,
  onChange: (team: APITeam) => Promise<*> | void,
};

function TeamSelectionForm({ value, onChange }: Props) {
  const [form] = Form.useForm();
  const handleFormSubmit = (event: ?SyntheticInputEvent<*>) => {
    if (event) {
      event.preventDefault();
    }
    form.validateFields((err, formValues) => {
      onChange(formValues.team);
    });
  };

  const { getFieldDecorator } = form;
  const formItemLayout = {
    labelCol: { span: 5 },
    wrapperCol: { span: 19 },
  };
  return (
    <Form onSubmit={handleFormSubmit} form={form}>
      <Row gutter={40}>
        <Col span={12}>
          <FormItem {...formItemLayout} label="Team" style={{ marginBottom: 0 }}>
            {getFieldDecorator("team", { initialValue: value })(<TeamSelectionComponent />)}
          </FormItem>
        </Col>
        <Col span={12}>
          <Button type="primary" htmlType="submit">
            Search
          </Button>
        </Col>
      </Row>
    </Form>
  );
}

export default TeamSelectionForm;
