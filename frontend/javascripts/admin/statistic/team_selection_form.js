// @flow
import { Row, Col, Form, Button } from "antd";
import * as React from "react";

import type { APITeam } from "types/api_flow_types";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";

const FormItem = Form.Item;

type Props = {
  form: Object,
  value?: ?APITeam,
  onChange: (team: APITeam) => Promise<*> | void,
};

class TeamSelectionForm extends React.PureComponent<Props> {
  handleFormSubmit = (event: ?SyntheticInputEvent<*>) => {
    if (event) {
      event.preventDefault();
    }
    this.props.form.validateFields((err, formValues) => {
      this.props.onChange(formValues.team);
    });
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
            <FormItem {...formItemLayout} label="Team" style={{ marginBottom: 0 }}>
              {getFieldDecorator("team", { initialValue: this.props.value })(
                <TeamSelectionComponent />,
              )}
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
}

export default Form.create()(TeamSelectionForm);
