// @flow

import * as React from "react";
import {
  Button,
  Spin,
  Icon,
  Collapse,
  Input,
  Checkbox,
  Alert,
  Form,
  Card,
  InputNumber,
  Col,
  Row,
  Tabs,
  Switch,
  Tooltip,
} from "antd";
import { Vector3Input, BoundingBoxInput } from "libs/vector_input";
import { FormItemWithInfo, jsonEditStyle } from "./helper_components";
import { validateLayerConfigurationJSON } from "./validation";

const FormItem = Form.Item;

export default function DefaultConfigComponent({ form }: { form: Object }) {
  const { getFieldDecorator } = form;

  return (
    <div>
      <Alert
        message="The following settings define the default configuration when viewing or creating an explorational tracing for this dataset. Use them to optimize the initial appearance of your dataset."
        type="info"
        showIcon
      />
      <Row gutter={24}>
        <Col span={6}>
          <FormItemWithInfo
            label="Position"
            info="The default position defined is defined in voxel-coordinates (x, y, z)."
          >
            {getFieldDecorator("defaultConfiguration.position")(<Vector3Input />)}
          </FormItemWithInfo>
        </Col>
        <Col span={6}>
          <FormItemWithInfo
            label="Zoom"
            info="A zoom of &ldquo;1&rdquo; will display the data in its original resolution."
          >
            {getFieldDecorator("defaultConfiguration.zoom")(
              <InputNumber style={{ width: "100%" }} />,
            )}
          </FormItemWithInfo>
        </Col>
        <Col span={6}>
          <FormItemWithInfo
            label="Segmentation Opacity"
            info="The segmentation layer will be overlayed using the specified percentage value (&ldquo;20&rdquo; means &ldquo;20%&rdquo; opacity)."
          >
            {getFieldDecorator("defaultConfiguration.segmentationOpacity")(
              <InputNumber style={{ width: "100%" }} />,
            )}
          </FormItemWithInfo>
        </Col>
        <Col span={6}>
          <FormItem label=" " colon={false}>
            {getFieldDecorator("defaultConfiguration.interpolation", {
              valuePropName: "checked",
            })(
              <Checkbox>
                Interpolation{" "}
                <Tooltip
                  title={
                    "If checked, bilinear interpolation will be used the the data is rendered."
                  }
                >
                  <Icon type="info-circle-o" style={{ color: "gray" }} />
                </Tooltip>
              </Checkbox>,
            )}
          </FormItem>
        </Col>
      </Row>
      <FormItemWithInfo
        label="Layer Configuration"
        info="Use the following JSON to define layer-specific properties, such as color, contrast and brightness."
      >
        {getFieldDecorator("defaultConfigurationLayersJson", {
          rules: [{ validator: validateLayerConfigurationJSON }],
        })(<Input.TextArea rows="10" style={jsonEditStyle} />)}
      </FormItemWithInfo>
    </div>
  );
}
