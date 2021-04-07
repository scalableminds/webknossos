// @flow

import _ from "lodash";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Form, Input, Checkbox, Alert, InputNumber, Col, Row, Tooltip, Table } from "antd";
import * as React from "react";

import { Vector3Input } from "libs/vector_input";
import { validateLayerViewConfigurationObjectJSON, syncValidator } from "types/validation";
import { getDefaultLayerViewConfiguration } from "types/schemas/dataset_view_configuration.schema";
import { layerViewConfigurations } from "messages";

import { FormItemWithInfo, jsonEditStyle } from "./helper_components";

const FormItem = Form.Item;

export default function DefaultConfigComponent() {
  const columns = [
    {
      title: "Name",
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

  const comments = {
    alpha: "20 for segmentation layer",
    loadingStrategy: "BEST_QUALITY_FIRST or PROGRESSIVE_QUALITY",
  };

  return (
    <div>
      <Alert
        message="The following settings define the default configuration when viewing or creating an explorational annotation for this dataset. Use them to optimize the first appearance of your dataset."
        type="info"
        showIcon
      />
      <Row gutter={24}>
        <Col span={6}>
          <FormItemWithInfo
            name={["defaultConfiguration", "position"]}
            label="Position"
            info="The default position is defined in voxel-coordinates (x, y, z)."
          >
            <Vector3Input />
          </FormItemWithInfo>
        </Col>
        <Col span={6}>
          <FormItemWithInfo
            name={["defaultConfiguration", "zoom"]}
            label="Zoom"
            info="A zoom of &ldquo;1&rdquo; will display the data in its original resolution."
            rules={[
              {
                validator: syncValidator(
                  value => value == null || value > 0,
                  "The zoom value must be greater than 0.",
                ),
              },
            ]}
          >
            <InputNumber style={{ width: "100%" }} />
          </FormItemWithInfo>
        </Col>
        <Col span={8}>
          <FormItem
            name={["defaultConfiguration", "interpolation"]}
            valuePropName="checked"
            label=" "
            colon={false}
          >
            <Checkbox>
              Interpolation{" "}
              <Tooltip title="If checked, bilinear interpolation will be used when rendering the data.">
                <InfoCircleOutlined style={{ color: "gray" }} />
              </Tooltip>
            </Checkbox>
          </FormItem>
        </Col>
      </Row>
      <Row gutter={32}>
        <Col span={12}>
          <FormItemWithInfo
            name="defaultConfigurationLayersJson"
            label="Layer Configuration"
            info="Use the following JSON to define layer-specific properties, such as color, alpha and intensityRange."
            rules={[{ validator: validateLayerViewConfigurationObjectJSON }]}
          >
            <Input.TextArea rows="10" style={jsonEditStyle} />
          </FormItemWithInfo>
        </Col>
        <Col span={12}>
          Valid layer view configurations and their default values:
          <br />
          <br />
          <Table
            columns={columns}
            dataSource={_.map(getDefaultLayerViewConfiguration(), (value, key: string) => ({
              name: layerViewConfigurations[key],
              key,
              value: value == null ? "not set" : value.toString(),
              comment: comments[key] || "",
            }))}
            size="small"
            pagination={false}
            className="large-table"
            scroll={{ x: "max-content" }}
          />
        </Col>
      </Row>
    </div>
  );
}
