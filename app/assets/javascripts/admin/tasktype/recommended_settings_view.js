// @flow
import * as React from "react";
import { Input, Form, Row, Col, Collapse, Tooltip, Icon } from "antd";
import { jsonEditStyle } from "dashboard/dataset/helper_components";
import { validateUserSettingsJSON } from "dashboard/dataset/validation";

const FormItem = Form.Item;
const { Panel } = Collapse;

const errorIcon = (
  <Tooltip title="The recommended user settings JSON has errors.">
    <Icon type="exclamation-circle" style={{ color: "#f5222d", marginLeft: 4 }} />
  </Tooltip>
);

export default function RecommendedSettingsView({ form }: { form: Object }) {
  return (
    <Collapse>
      <Panel
        header={
          <React.Fragment>
            Recommended User Settings {form.getFieldError("recommendedConfiguration") && errorIcon}
          </React.Fragment>
        }
        forceRender
      >
        <FormItem hasFeedback>
          <Row gutter={16}>
            <Col span={12}>
              {form.getFieldDecorator("recommendedConfiguration", {
                rules: [
                  {
                    validator: validateUserSettingsJSON,
                  },
                ],
              })(<Input.TextArea spellCheck={false} rows={20} style={jsonEditStyle} />)}
            </Col>
            <Col span={12}>Some Description Text</Col>
          </Row>
        </FormItem>
      </Panel>
    </Collapse>
  );
}
