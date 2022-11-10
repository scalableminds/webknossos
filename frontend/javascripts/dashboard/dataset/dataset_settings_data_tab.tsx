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
  Space,
  Button,
} from "antd";
import * as React from "react";
import { Vector3Input, BoundingBoxInput } from "libs/vector_input";
import { getBitDepth } from "oxalis/model/accessors/dataset_accessor";
import { validateDatasourceJSON, isValidJSON, syncValidator } from "types/validation";
import { BoundingBoxObject, OxalisState } from "oxalis/store";
import {
  Hideable,
  FormItemWithInfo,
  RetryingErrorBoundary,
  jsonEditStyle,
} from "dashboard/dataset/helper_components";
import { jsonStringify, parseAsMaybe } from "libs/utils";
import { DataLayer } from "types/schemas/datasource.types";
import { getDatasetNameRules, layerNameRules } from "admin/dataset/dataset_components";
import { useSelector } from "react-redux";
import { DeleteOutlined } from "@ant-design/icons";
import { APIDataLayer } from "types/api_flow_types";
import { Vector3 } from "oxalis/constants";

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
    const dataSourceFromAdvancedTab = parseAsMaybe(form.getFieldValue("dataSourceJson")).getOrElse(
      null,
    );
    // Copy from advanced to simple: update form values
    form.setFieldsValue({
      dataSource: dataSourceFromAdvancedTab,
    });
  }
};

export default function DatasetSettingsDataTab({
  allowRenamingDataset,
  isReadOnlyDataset,
  form,
  activeDataSourceEditMode,
  onChange,
  additionalAlert,
}: {
  allowRenamingDataset: boolean;
  isReadOnlyDataset: boolean;
  form: FormInstance;
  activeDataSourceEditMode: "simple" | "advanced";
  onChange: (arg0: "simple" | "advanced") => void;
  additionalAlert?: React.ReactNode | null | undefined;
}) {
  // Using the return value of useWatch for the `dataSource` var
  // yields outdated values. Therefore, the hook only exists for listening.
  Form.useWatch("dataSource", form);
  // Then, the newest value can be retrieved with getFieldValue
  const dataSource = form.getFieldValue("dataSource");
  const dataSourceJson = Form.useWatch("dataSourceJson", form);

  const isJSONValid = isValidJSON(dataSourceJson);

  return (
    <div>
      <div
        style={{
          textAlign: "right",
        }}
      >
        <Tooltip
          title={
            isJSONValid
              ? "Switch between simple and advanced mode"
              : "Please ensure that the supplied config JSON is valid."
          }
        >
          <Switch
            checkedChildren="Advanced"
            unCheckedChildren="Simple"
            checked={activeDataSourceEditMode === "advanced"}
            disabled={isReadOnlyDataset || !isJSONValid}
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
            allowRenamingDataset={allowRenamingDataset}
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

function SimpleDatasetForm({
  allowRenamingDataset,
  isReadOnlyDataset,
  dataSource,
  form,
}: {
  allowRenamingDataset: boolean;
  isReadOnlyDataset: boolean;
  dataSource: Record<string, any>;
  form: FormInstance;
}) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const onRemoveLayer = (layer: DataLayer) => {
    const oldLayers = form.getFieldValue(["dataSource", "dataLayers"]);
    const newLayers = oldLayers.filter(
      (existingLayer: DataLayer) => existingLayer.name !== layer.name,
    );
    form.setFieldsValue({
      dataSource: {
        dataLayers: newLayers,
      },
    });
    syncDataSourceFields(form, "advanced");
  };
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
                validateFirst
                rules={getDatasetNameRules(activeUser, allowRenamingDataset)}
              >
                <Input
                  // Renaming an existing DS is not supported right now
                  disabled={isReadOnlyDataset || !allowRenamingDataset}
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
                rules={[
                  {
                    required: true,
                    message: "Please provide a scale for the dataset.",
                  },
                  {
                    validator: syncValidator(
                      (value: Vector3) => value && value.every((el) => el > 0),
                      "Each component of the scale must be greater than 0",
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
            <SimpleLayerForm
              isReadOnlyDataset={isReadOnlyDataset}
              layer={layer}
              index={idx}
              onRemoveLayer={onRemoveLayer}
              form={form}
            />
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
  onRemoveLayer,
  form,
}: {
  isReadOnlyDataset: boolean;
  layer: DataLayer;
  index: number;
  onRemoveLayer: (layer: DataLayer) => void;
  form: FormInstance;
}) {
  const dataLayers = Form.useWatch(["dataSource", "dataLayers"]);
  const category = Form.useWatch(["dataSource", "dataLayers", index, "category"]);
  const isSegmentation = category === "segmentation";
  const bitDepth = getBitDepth(layer);

  const mayLayerBeRemoved = !isReadOnlyDataset && dataLayers?.length > 1;

  React.useEffect(() => {
    // Always validate all fields so that in the case of duplicate layer
    // names all relevant fields are properly validated.
    // This is a workaround, since shouldUpdate=true on a
    // FormItemWithInfo doesn't work for some reason.
    form.validateFields();
  }, [dataLayers]);

  return (
    <div
      style={{
        width: "100%",
      }}
    >
      {mayLayerBeRemoved && (
        <div style={{ float: "right" }}>
          <Tooltip title="Remove Layer">
            <Button shape="circle" icon={<DeleteOutlined />} onClick={() => onRemoveLayer(layer)} />
          </Tooltip>
        </div>
      )}
      <Row gutter={48}>
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
              ...layerNameRules,
              {
                validator: syncValidator(
                  (value: string) =>
                    dataLayers.filter((someLayer: APIDataLayer) => someLayer.name === value)
                      .length <= 1,
                  "Layer names must be unique.",
                ),
              },
            ]}
          >
            <Input
              // the name of a layer depends on the folder name in wkw. Therefore, don't allow
              // editing the layer name for wkw.
              disabled={isReadOnlyDataset || layer.dataFormat === "wkw"}
              style={{
                width: 300,
              }}
            />
          </FormItemWithInfo>

          <Space size="large">
            <FormItemWithInfo
              label="Data Format"
              style={{
                marginBottom: 24,
              }}
              info="The data format of the layer."
            >
              <Select disabled value={layer.dataFormat} style={{ width: 120 }}>
                <Select.Option value={layer.dataFormat}>{layer.dataFormat}</Select.Option>
              </Select>
            </FormItemWithInfo>
            <FormItemWithInfo
              label="Element Class"
              style={{
                marginBottom: 24,
              }}
              info="The element class (data type) of the layer."
            >
              <Select disabled value={layer.elementClass} style={{ width: 120 }}>
                <Select.Option value={layer.elementClass}>{layer.elementClass}</Select.Option>
              </Select>
            </FormItemWithInfo>
            {"numChannels" in layer ? (
              <FormItemWithInfo
                label="Channel Count"
                style={{
                  marginBottom: 24,
                }}
                info="The channel count of the layer."
              >
                <Select disabled value={layer.numChannels} style={{ width: 120 }}>
                  <Select.Option value={layer.numChannels}>{layer.numChannels}</Select.Option>
                </Select>
              </FormItemWithInfo>
            ) : null}
          </Space>

          <FormItemWithInfo
            label="Magnifications"
            style={{
              marginBottom: 24,
            }}
            info="The magnifications of the layer."
          >
            <Select
              mode="multiple"
              disabled
              allowClear
              value={getMags(layer).map((mag) => mag.toString())}
              style={{ width: 360 }}
            >
              {getMags(layer).map((mag) => (
                <Select.Option key={mag.toString()} value={mag.toString()}>
                  {typeof mag === "number" ? mag : mag.join("-")}
                </Select.Option>
              ))}
            </Select>
          </FormItemWithInfo>
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
              {
                warningOnly: true,
                validator: (rule, value) =>
                  value == null || value === ""
                    ? Promise.reject(
                        new Error(
                          "When left empty, annotating this layer later will only be possible with manually chosen segment IDs.",
                        ),
                      )
                    : Promise.resolve(),
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
              initialValue={
                "largestSegmentId" in layer && layer.largestSegmentId != null
                  ? `${layer.largestSegmentId}`
                  : undefined
              }
              rules={[
                {
                  validator: (rule, value) =>
                    value == null || value === "" || (value > 0 && value < 2 ** bitDepth)
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error(
                            `The largest segmentation ID must be greater than 0 and smaller than 2^${bitDepth}. You can also leave this field empty, but annotating this layer later will only be possible with manually chosen segment IDs.`,
                          ),
                        ),
                },
                {
                  warningOnly: true,
                  validator: (rule, value) =>
                    value == null || value === ""
                      ? Promise.reject(
                          new Error(
                            "When left empty, annotating this layer later will only be possible with manually chosen segment IDs.",
                          ),
                        )
                      : Promise.resolve(),
                },
              ]}
            >
              <InputNumber
                disabled={isReadOnlyDataset}
                // @ts-ignore returning undefined does work without problems
                parser={(value: string | undefined) => {
                  if (value == null || value === "") {
                    return undefined;
                  }
                  return parseInt(value, 10);
                }}
              />
            </FormItemWithInfo>
          ) : null}
        </Col>
      </Row>
    </div>
  );
}
