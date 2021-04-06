// @flow
import { Alert, List, Input, Form, InputNumber, Col, Row, Switch, Tooltip } from "antd";
import * as React from "react";

import { Vector3Input, BoundingBoxInput } from "libs/vector_input";
import { getBitDepth } from "oxalis/model/accessors/dataset_accessor";
import { validateDatasourceJSON, isValidJSON, syncValidator } from "types/validation";

import {
  Hideable,
  FormItemWithInfo,
  RetryingErrorBoundary,
  jsonEditStyle,
} from "./helper_components";

const FormItem = Form.Item;

export default function SimpleAdvancedDataForm({
  isReadOnlyDataset,
  form,
  activeDataSourceEditMode,
  onChange,
  additionalAlert,
}: {
  isReadOnlyDataset: boolean,
  form: Object,
  activeDataSourceEditMode: "simple" | "advanced",
  onChange: ("simple" | "advanced") => void,
  additionalAlert: ?React.Node,
}) {
  if (!form) return null;
  const dataSource =
    form.getFieldValue("dataSourceJson") && isValidJSON(form.getFieldValue("dataSourceJson"))
      ? JSON.parse(form.getFieldValue("dataSourceJson"))
      : null;

  const isJSONInvalid = dataSource == null;

  return (
    <div>
      <div style={{ textAlign: "right" }}>
        <Tooltip
          title={
            isJSONInvalid
              ? "Please ensure that the supplied config JSON is valid."
              : "Switch between simple and advanced mode"
          }
        >
          <Switch
            checkedChildren="Advanced"
            unCheckedChildren="Simple"
            checked={activeDataSourceEditMode === "advanced"}
            disabled={isReadOnlyDataset || isJSONInvalid}
            style={{ marginBottom: 6 }}
            onChange={bool => {
              const key = bool ? "advanced" : "simple";
              onChange(key);
            }}
          />
        </Tooltip>
      </div>

      {isReadOnlyDataset ? (
        <Alert
          message="This dataset is read-only, therefore certain options are disabled."
          type="warning"
          showIcon
        />
      ) : null}

      {additionalAlert}

      <Hideable hidden={activeDataSourceEditMode !== "simple"}>
        <RetryingErrorBoundary>
          <SimpleDatasetForm
            isReadOnlyDataset={isReadOnlyDataset}
            form={form}
            dataSource={dataSource}
          />
        </RetryingErrorBoundary>
      </Hideable>

      <Hideable hidden={activeDataSourceEditMode !== "advanced"}>
        <FormItem
          name="dataSourceJson"
          label="Dataset Configuration"
          hasFeedback
          rules={[
            {
              required: true,
              message: "Please provide a dataset configuration.",
            },
            {
              validator: validateDatasourceJSON,
            },
          ]}
        >
          <Input.TextArea rows={20} style={jsonEditStyle} />
        </FormItem>
      </Hideable>
    </div>
  );
}

function SimpleDatasetForm({ isReadOnlyDataset, form, dataSource }) {
  return (
    <div>
      <List header={<div style={{ fontWeight: "bold" }}>Dataset</div>}>
        <List.Item>
          <FormItemWithInfo
            name={["dataSource", "scale"]}
            label="Voxel Size"
            info="The voxel size defines the extent (for x, y, z) of one voxel in nanometer."
            initialValue={dataSource != null ? dataSource.scale : [0, 0, 0]}
            rules={[
              {
                required: true,
                message: "Please provide a scale for the dataset.",
              },
              {
                validator: syncValidator(
                  value => value && value.every(el => el > 0),
                  "Each component of the scale must be larger than 0",
                ),
              },
            ]}
          >
            <Vector3Input disabled={isReadOnlyDataset} style={{ width: 400 }} allowDecimals />
          </FormItemWithInfo>
        </List.Item>
      </List>

      <List header={<div style={{ fontWeight: "bold" }}>Layers</div>}>
        {(dataSource || { dataLayers: [] }).dataLayers.map((layer, idx) => (
          <List.Item key={`layer-${layer.name}`}>
            <SimpleLayerForm
              isReadOnlyDataset={isReadOnlyDataset}
              layer={layer}
              index={idx}
              form={form}
            />
          </List.Item>
        ))}
      </List>
    </div>
  );
}

function SimpleLayerForm({ isReadOnlyDataset, layer, index }) {
  const isSegmentation = layer.category === "segmentation";
  const bitDepth = getBitDepth(layer);
  const boundingBoxValue =
    layer.dataFormat === "knossos" ? layer.sections[0].boundingBox : layer.boundingBox;
  return (
    <Row gutter={48} style={{ width: "100%" }}>
      <Col span={5}>
        <div style={{ paddingTop: 9, color: "rgba(0, 0, 0, 0.85)" }}>
          {index + 1}. Layer &ldquo;{layer.name}&rdquo;:
        </div>
      </Col>
      <Col span={17}>
        <FormItemWithInfo
          name={
            layer.dataFormat === "knossos"
              ? ["dataSource", "dataLayers", index, "sections", 0, "boundingBox"]
              : ["dataSource", "dataLayers", index, "boundingBox"]
          }
          label="Bounding box"
          style={{ marginBottom: 2 }}
          info="The bounding box defines the extent of the data in the format x, y, z, width, height, depth (in voxel coordinates)."
          initialValue={boundingBoxValue}
          rules={[
            {
              required: true,
              message: "Please define a valid bounding box.",
            },
            {
              validator: syncValidator(
                value => value.width !== 0 && value.height !== 0 && value.depth !== 0,
                "Width, height and depth must not be zero",
              ),
            },
          ]}
        >
          <BoundingBoxInput disabled={isReadOnlyDataset} style={{ width: 300 }} />
        </FormItemWithInfo>

        {isSegmentation ? (
          <FormItemWithInfo
            name={["dataSource", "dataLayers", index, "largestSegmentId"]}
            label="Largest segment ID"
            info="The largest segment ID specifies the highest id which exists in this segmentation layer. When users extend this segmentation, new IDs will be assigned starting from that value."
            initialValue={layer.largestSegmentId}
            rules={[
              {
                required: true,
                message: "Please provide a largest segment ID for the segmentation layer",
              },
              {
                validator: (rule, value) =>
                  value > 0 && value < 2 ** bitDepth
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error(
                          `The largest segmentation ID must be larger than 0 and smaller than 2^${bitDepth}`,
                        ),
                      ),
              },
            ]}
          >
            <InputNumber disabled={isReadOnlyDataset} />
          </FormItemWithInfo>
        ) : null}
      </Col>
    </Row>
  );
}
