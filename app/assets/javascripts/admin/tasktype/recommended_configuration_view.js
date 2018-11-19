// @flow
import * as React from "react";
import { Input, Form, Collapse, Tooltip, Icon, Checkbox } from "antd";
import { jsonEditStyle } from "dashboard/dataset/helper_components";
import { validateUserSettingsJSON } from "dashboard/dataset/validation";

const FormItem = Form.Item;
const { Panel } = Collapse;

const errorIcon = (
  <Tooltip title="The recommended user settings JSON has errors.">
    <Icon type="exclamation-circle" style={{ color: "#f5222d", marginLeft: 4 }} />
  </Tooltip>
);

export default function RecommendedConfigurationView({
  form,
  enabled,
  onChangeEnabled,
}: {
  form: Object,
  enabled: boolean,
  onChangeEnabled: boolean => void,
}) {
  return (
    <Collapse
      onChange={openedPanels => onChangeEnabled(openedPanels.length === 1)}
      activeKey={enabled ? "config" : null}
    >
      <Panel
        key="config"
        header={
          <React.Fragment>
            <Checkbox checked={enabled} style={{ marginRight: 10 }} /> Add Recommended User Settings
            {enabled && form.getFieldError("recommendedConfiguration") && errorIcon}
          </React.Fragment>
        }
        showArrow={false}
      >
        <FormItem>
          The recommended configuration will be displayed to users when starting to trace a task
          with this task type. The user is able to accept or decline this recommendation.
          {form.getFieldDecorator("recommendedConfiguration", {
            rules: [
              {
                validator: validateUserSettingsJSON,
              },
            ],
          })(<Input.TextArea spellCheck={false} rows={20} style={jsonEditStyle} />)}
        </FormItem>
      </Panel>
    </Collapse>
  );
}
