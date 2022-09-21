import {
  Alert,
  List,
  Input,
  Form,
  InputNumber,
  Col,
  Row,
  Switch,
  Tooltip,
  FormInstance,
  Select,
} from "antd";
import * as React from "react";
import { Vector3Input, BoundingBoxInput } from "libs/vector_input";
import { getBitDepth } from "oxalis/model/accessors/dataset_accessor";
import { validateDatasourceJSON, isValidJSON, syncValidator } from "types/validation";
import { BoundingBoxObject } from "oxalis/store";
import {
  Hideable,
  FormItemWithInfo,
  RetryingErrorBoundary,
  jsonEditStyle,
} from "dashboard/dataset/helper_components";
import { jsonStringify } from "libs/utils";
import { DataLayer } from "types/schemas/datasource.types";

const FormItem = Form.Item;

export const syncDataSourceFields = (
  form: FormInstance,
  syncTargetTabKey: "simple" | "advanced",
): void => {
  if (!form) {
    return;
  }

  if (syncTargetTabKey === "advanced") {
    // Copy from simple to advanced: update json
    const dataSourceFromSimpleTab = form.getFieldValue("dataSource");
    form.setFieldsValue({
      dataSourceJson: jsonStringify(dataSourceFromSimpleTab),
    });
  } else {
    const dataSourceFromAdvancedTab = JSON.parse(form.getFieldValue("dataSourceJson"));
    // Copy from advanced to simple: update form values
    form.setFieldsValue({
      dataSource: dataSourceFromAdvancedTab,
    });
  }
};

export default function DatasetSettingsDataTab({
  isReadOnlyDataset,
  form,
  activeDataSourceEditMode,
  onChange,
  additionalAlert,
}: {
  isReadOnlyDataset: boolean;
  form: FormInstance;
  activeDataSourceEditMode: "simple" | "advanced";
  onChange: (arg0: "simple" | "advanced") => void;
  additionalAlert?: React.ReactNode | null | undefined;
}) {
  const dataSourceJson = Form.useWatch("dataSourceJson", form);
  const dataSource =
    dataSourceJson && isValidJSON(dataSourceJson)
      ? JSON.parse(form.getFieldValue("dataSourceJson"))
      : null;

  const isJSONInvalid = dataSource == null;
  return (
    <div>
      <div
        style={{
          textAlign: "right",
        }}
      >
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
            style={{
              marginBottom: 6,
            }}
            onChange={(bool) => {
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
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ isReadOnlyDataset: boolean; form: FormInst... Remove this comment to see the full error message
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

function SimpleDatasetForm({
  isReadOnlyDataset,
  dataSource,
}: {
  isReadOnlyDataset: boolean;
  dataSource: Record<string, any>;
}) {
  return (
    <div>
      <List
        header={
          <div
            style={{
              fontWeight: "bold",
            }}
          >
            Dataset
          </div>
        }
      >
        <List.Item>
          <Row
            gutter={48}
            style={{
              width: "100%",
            }}
          >
            <Col span={10}>
              <FormItemWithInfo
                name={["dataSource", "id", "name"]}
                label="Name"
                info="The name of the dataset"
                rules={[
                  {
                    required: true,
                    message: "Please provide a name for the dataset.",
                  },
                  {
                    validator: syncValidator((value) => value.length > 3, "..."),
                  },
                ]}
              >
                <Input
                  disabled={isReadOnlyDataset}
                  style={{
                    width: 400,
                  }}
                />
              </FormItemWithInfo>
            </Col>
            <Col span={12}>
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
                      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'el' implicitly has an 'any' type.
                      (value) => value && value.every((el) => el > 0),
                      "Each component of the scale must be larger than 0",
                    ),
                  },
                ]}
              >
                <Vector3Input
                  disabled={isReadOnlyDataset}
                  style={{
                    width: 400,
                  }}
                  allowDecimals
                />
              </FormItemWithInfo>
            </Col>
          </Row>
        </List.Item>
      </List>

      <List
        locale={{ emptyText: "No Layers" }}
        header={
          <div
            style={{
              fontWeight: "bold",
            }}
          >
            Layers
          </div>
        }
      >
        {dataSource?.dataLayers?.map((layer: DataLayer, idx: number) => (
          <List.Item key={`layer-${layer.name}`}>
            <SimpleLayerForm isReadOnlyDataset={isReadOnlyDataset} layer={layer} index={idx} />
          </List.Item>
        ))}
      </List>
    </div>
  );
}

function getMags(layer: DataLayer) {
  if ("wkwResolutions" in layer) {
    return layer.wkwResolutions.map((res) => res.resolution);
  }

  return layer.mags.map((res) => res.mag);
}

function SimpleLayerForm({
  isReadOnlyDataset,
  layer,
  index,
}: {
  isReadOnlyDataset: boolean;
  layer: DataLayer;
  index: number;
}) {
  const isSegmentation = layer.category === "segmentation";
  const bitDepth = getBitDepth(layer);
  return (
    <Row
      gutter={48}
      style={{
        width: "100%",
      }}
    >
      <Col span={10}>
        <FormItemWithInfo
          name={["dataSource", "dataLayers", index, "name"]}
          label="Name"
          style={{
            marginBottom: 24,
          }}
          info="The name of the layer."
          rules={[
            {
              required: true,
              message: "Please provide a valid layer name.",
            },
            {
              validator: syncValidator((value: string) => value.length > 3, "..."),
            },
          ]}
        >
          <Input
            disabled={isReadOnlyDataset}
            style={{
              width: 300,
            }}
          />
        </FormItemWithInfo>
        <p>
          <div>
            <b>Data Format</b>: {layer.dataFormat}
          </div>
          <div>
            <b>Voxel type</b>: {layer.elementClass}
          </div>
          {"numChannels" in layer ? (
            <div>
              <b>Channel count</b>: {layer.numChannels}
            </div>
          ) : null}
          <div>
            <b>Magnifications</b>:{" "}
            <ul>
              {getMags(layer).map((mag) => (
                <li key={mag.toString()}>{typeof mag === "number" ? mag : mag.join("-")}</li>
              ))}
            </ul>
          </div>
        </p>
      </Col>
      <Col span={12}>
        <FormItemWithInfo
          name={["dataSource", "dataLayers", index, "boundingBox"]}
          label="Bounding box"
          style={{
            marginBottom: 24,
          }}
          info="The bounding box defines the extent of the data in the format x, y, z, width, height, depth (in voxel coordinates)."
          rules={[
            {
              required: true,
              message: "Please define a valid bounding box.",
            },
            {
              validator: syncValidator(
                (value: BoundingBoxObject) =>
                  value.width !== 0 && value.height !== 0 && value.depth !== 0,
                "Width, height and depth must not be zero",
              ),
            },
          ]}
        >
          <BoundingBoxInput
            disabled={isReadOnlyDataset}
            style={{
              width: 300,
            }}
          />
        </FormItemWithInfo>

        <Form.Item
          name={["dataSource", "dataLayers", index, "category"]}
          label="Category"
          rules={[{ required: true }]}
        >
          <Select
            placeholder="Select the category of the layer"
            style={{
              width: 300,
            }}
          >
            <Select.Option value="color">Color / grayscale</Select.Option>
            <Select.Option value="segmentation">Segmentation</Select.Option>
          </Select>
        </Form.Item>

        {isSegmentation ? (
          <FormItemWithInfo
            name={["dataSource", "dataLayers", index, "largestSegmentId"]}
            label="Largest segment ID"
            info="The largest segment ID specifies the highest id which exists in this segmentation layer. When users extend this segmentation, new IDs will be assigned starting from that value."
            initialValue={`${layer.largestSegmentId}`}
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
