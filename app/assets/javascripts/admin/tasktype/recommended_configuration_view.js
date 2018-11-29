// @flow
import { Checkbox, Col, Collapse, Form, Icon, Input, Row, Tooltip } from "antd";
import * as React from "react";

import type { DatasetConfiguration, UserConfiguration } from "oxalis/store";
import { jsonEditStyle } from "dashboard/dataset/helper_components";
import { jsonStringify } from "libs/utils";
import { validateUserSettingsJSON } from "dashboard/dataset/validation";

const FormItem = Form.Item;
const { Panel } = Collapse;

export const DEFAULT_RECOMMENDED_CONFIGURATION: $Shape<{|
  ...UserConfiguration,
  ...DatasetConfiguration,
|}> = {
  clippingDistance: 500,
  clippingDistanceArbitrary: 60,
  displayCrosshair: true,
  displayScalebars: false,
  dynamicSpaceDirection: true,
  keyboardDelay: 0,
  moveValue: 500,
  moveValue3d: 600,
  mouseRotateValue: 0.001,
  newNodeNewTree: false,
  highlightCommentedNodes: false,
  overrideNodeRadius: true,
  particleSize: 5,
  rotateValue: 0.01,
  sphericalCapRadius: 500,
  tdViewDisplayPlanes: false,
  fourBit: false,
  interpolation: true,
  quality: 0,
  segmentationOpacity: 0,
  highlightHoveredCellId: false,
  zoom: 0.8,
  renderMissingDataBlack: false,
};

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
        <Row gutter={32}>
          <Col span={18}>
            <FormItem>
              The recommended configuration will be displayed to users when starting to trace a task
              with this task type. The user is able to accept or decline this recommendation.
              <br />
              {form.getFieldDecorator("recommendedConfiguration", {
                rules: [
                  {
                    validator: validateUserSettingsJSON,
                  },
                ],
              })(
                <Input.TextArea
                  spellCheck={false}
                  autosize={{ minRows: 20 }}
                  style={jsonEditStyle}
                />,
              )}
            </FormItem>
          </Col>
          <Col span={6}>
            Valid settings and their default values: <br />
            <pre>{jsonStringify(DEFAULT_RECOMMENDED_CONFIGURATION)}</pre>
          </Col>
        </Row>
      </Panel>
    </Collapse>
  );
}
