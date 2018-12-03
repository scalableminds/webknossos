// @flow
import { Checkbox, Col, Collapse, Form, Icon, Input, Row, Tooltip, Table } from "antd";
import * as React from "react";
import _ from "lodash";

import type { DatasetConfiguration, UserConfiguration } from "oxalis/store";
import { jsonEditStyle } from "dashboard/dataset/helper_components";
import { settings } from "messages";
import { validateUserSettingsJSON } from "dashboard/dataset/validation";

const FormItem = Form.Item;
const { Panel } = Collapse;

export const DEFAULT_RECOMMENDED_CONFIGURATION: $Shape<{|
  ...UserConfiguration,
  ...DatasetConfiguration,
|}> = {
  clippingDistance: 80,
  moveValue: 500,
  displayCrosshair: true,
  displayScalebars: false,
  dynamicSpaceDirection: true,
  keyboardDelay: 0,
  newNodeNewTree: false,
  highlightCommentedNodes: false,
  overrideNodeRadius: true,
  particleSize: 5,
  tdViewDisplayPlanes: false,
  fourBit: false,
  interpolation: true,
  quality: 0,
  segmentationOpacity: 0,
  highlightHoveredCellId: false,
  zoom: 0.8,
  renderMissingDataBlack: false,
  clippingDistanceArbitrary: 60,
  moveValue3d: 600,
  mouseRotateValue: 0.001,
  rotateValue: 0.01,
  sphericalCapRadius: 500,
};

export const settingComments = {
  clippingDistance: "orthogonal mode",
  moveValue: "orthogonal mode",
  quality: "0 (high), 1 (medium), 2 (low)",
  clippingDistanceArbitrary: "flight/oblique mode",
  moveValue3d: "flight/oblique mode",
};

const errorIcon = (
  <Tooltip title="The recommended user settings JSON has errors.">
    <Icon type="exclamation-circle" style={{ color: "#f5222d", marginLeft: 4 }} />
  </Tooltip>
);

const columns = [
  {
    title: "Display Name",
    dataIndex: "name",
  },
  {
    title: "Key",
    dataIndex: "key",
  },
  {
    title: "Default Value",
    dataIndex: "value",
  },
  {
    title: "Comment",
    dataIndex: "comment",
  },
];

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
          <Col span={12}>
            <FormItem>
              The recommended configuration will be displayed to users when starting to trace a task
              with this task type. The user is able to accept or decline this recommendation.
              <br />
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
          <Col span={12}>
            Valid settings and their default values: <br />
            <br />
            <Table
              columns={columns}
              dataSource={_.map(DEFAULT_RECOMMENDED_CONFIGURATION, (value, key) => ({
                name: settings[key],
                key,
                value: value.toString(),
                comment: settingComments[key] || "",
              }))}
              size="small"
              pagination={false}
            />
          </Col>
        </Row>
      </Panel>
    </Collapse>
  );
}
