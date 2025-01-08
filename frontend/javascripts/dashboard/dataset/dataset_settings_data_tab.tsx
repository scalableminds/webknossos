import {
  List,
  Input,
  Form,
  InputNumber,
  Col,
  Row,
  Switch,
  Tooltip,
  type FormInstance,
  Select,
  Space,
  Button,
} from "antd";
import * as React from "react";
import { Vector3Input, BoundingBoxInput } from "libs/vector_input";
import { getBitDepth } from "oxalis/model/accessors/dataset_accessor";
import { validateDatasourceJSON, isValidJSON, syncValidator } from "types/validation";
import type { BoundingBoxObject, OxalisState } from "oxalis/store";
import {
  Hideable,
  FormItemWithInfo,
  RetryingErrorBoundary,
  jsonEditStyle,
} from "dashboard/dataset/helper_components";
import { startFindLargestSegmentIdJob } from "admin/admin_rest_api";
import { jsonStringify, parseMaybe } from "libs/utils";
import type { DataLayer } from "types/schemas/datasource.types";
import { getDatasetNameRules, layerNameRules } from "admin/dataset/dataset_components";
import { useSelector } from "react-redux";
import { DeleteOutlined } from "@ant-design/icons";
import { type APIDataLayer, type APIDataset, APIJobType } from "types/api_flow_types";
import { useStartAndPollJob } from "admin/job/job_hooks";
import { AllUnits, LongUnitToShortUnitMap, type Vector3 } from "oxalis/constants";
import Toast from "libs/toast";
import type { ArbitraryObject } from "types/globals";

const FormItem = Form.Item;

export const syncDataSourceFields = (
  form: FormInstance,
  syncTargetTabKey: "simple" | "advanced",
  // Syncing the dataset name is optional as this is needed for the add remote view, but not for the edit view.
  // In the edit view, the datasource.id fields should never be changed and the backend will automatically ignore all changes to the id field.
  syncDatasetName = false,
): void => {
  if (!form) {
    return;
  }

  if (syncTargetTabKey === "advanced") {
    // Copy from simple to advanced: update json
    const dataSourceFromSimpleTab = form.getFieldValue("dataSource");
    if (syncDatasetName && dataSourceFromSimpleTab) {
      dataSourceFromSimpleTab.id ??= {};
      dataSourceFromSimpleTab.id.name = form.getFieldValue(["dataset", "name"]);
    }
    form.setFieldsValue({
      dataSourceJson: jsonStringify(dataSourceFromSimpleTab),
    });
  } else {
    const dataSourceFromAdvancedTab = parseMaybe(
      form.getFieldValue("dataSourceJson"),
    ) as ArbitraryObject | null;
    // Copy from advanced to simple: update form values
    if (syncDatasetName && dataSourceFromAdvancedTab?.id?.name) {
      form.setFieldsValue({
        dataset: {
          name: dataSourceFromAdvancedTab.id.name,
        },
      });
    }
    form.setFieldsValue({
      dataSource: dataSourceFromAdvancedTab,
    });
  }
};

export default function DatasetSettingsDataTab({
  form,
  activeDataSourceEditMode,
  onChange,
  dataset,
}: {
  form: FormInstance;
  activeDataSourceEditMode: "simple" | "advanced";
  onChange: (arg0: "simple" | "advanced") => void;
  dataset?: APIDataset | null | undefined;
}) {
  // Using the return value of useWatch for the `dataSource` var
  // yields outdated values. Therefore, the hook only exists for listening.
  Form.useWatch("dataSource", form);
  // Then, the newest value can be retrieved with getFieldValue
  const dataSource = form.getFieldValue("dataSource");
  const dataSourceJson = Form.useWatch("dataSourceJson", form);
  const datasetStoredLocationInfo = dataset
    ? ` (as stored on datastore ${dataset?.dataStore.name} at ${dataset?.owningOrganization}/${dataset?.directoryName})`
    : "";

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
            disabled={!isJSONValid}
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

      <Hideable hidden={activeDataSourceEditMode !== "simple"}>
        <RetryingErrorBoundary>
          <SimpleDatasetForm dataset={dataset} form={form} dataSource={dataSource} />
        </RetryingErrorBoundary>
      </Hideable>

      <Hideable hidden={activeDataSourceEditMode !== "advanced"}>
        <FormItem
          name="dataSourceJson"
          label={"Dataset Configuration" + datasetStoredLocationInfo}
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
  dataSource,
  form,
  dataset,
}: {
  dataSource: Record<string, any>;
  form: FormInstance;
  dataset: APIDataset | null | undefined;
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
          <div
            style={{
              width: "100%",
            }}
          >
            <Row gutter={48}>
              <Col span={24} xl={12}>
                <FormItemWithInfo
                  // The dataset name is not synced with the datasource.id.name in the advanced settings, because datasource.id represents a DataSourceId
                  // where datasource.id.name represents the dataset's directoryName and not the dataset's name.
                  name={["dataset", "name"]}
                  label="Name"
                  info="The name of the dataset"
                  validateFirst
                  rules={getDatasetNameRules(activeUser)}
                >
                  <Input
                    style={{
                      width: 408,
                    }}
                  />
                </FormItemWithInfo>
              </Col>
              <Col span={24} xl={12}>
                <FormItemWithInfo
                  name={["dataSource", "scale", "factor"]}
                  label="Voxel Size"
                  info="The voxel size defines the extent (for x, y, z) of one voxel in the specified unit."
                  rules={[
                    {
                      required: true,
                      message: "Please provide a voxel size for the dataset.",
                    },
                    {
                      validator: syncValidator(
                        (value: Vector3) => value?.every((el) => el > 0),
                        "Each component of the voxel size must be greater than 0",
                      ),
                    },
                  ]}
                >
                  <Vector3Input
                    style={{
                      width: 400,
                    }}
                    allowDecimals
                  />
                </FormItemWithInfo>
                <Space size="large" />
                <FormItemWithInfo
                  name={["dataSource", "scale", "unit"]}
                  label="Unit"
                  info="The unit in which the voxel size is defined."
                  rules={[
                    {
                      required: true,
                      message: "Please provide a unit for the voxel scale of the dataset.",
                    },
                  ]}
                >
                  <Select
                    style={{ width: 120 }}
                    options={AllUnits.map((unit) => ({
                      value: unit,
                      label: (
                        <span>
                          <Tooltip title={unit}>{LongUnitToShortUnitMap[unit]}</Tooltip>
                        </span>
                      ),
                    }))}
                  />
                </FormItemWithInfo>
              </Col>
            </Row>
          </div>
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
          // the layer name may change in this view, the order does not, so idx is the right key choice here
          <List.Item key={`layer-${idx}`}>
            <SimpleLayerForm
              dataset={dataset}
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
  layer,
  index,
  onRemoveLayer,
  form,
  dataset,
}: {
  layer: DataLayer;
  index: number;
  onRemoveLayer: (layer: DataLayer) => void;
  form: FormInstance;
  dataset: APIDataset | null | undefined;
}) {
  const dataLayers = Form.useWatch(["dataSource", "dataLayers"]);
  const category = Form.useWatch(["dataSource", "dataLayers", index, "category"]);
  const isSegmentation = category === "segmentation";
  const bitDepth = getBitDepth(layer);

  const mayLayerBeRemoved = dataLayers?.length > 1;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Always revalidate in case the user changes the data layers in the form.
  React.useEffect(() => {
    // Always validate all fields so that in the case of duplicate layer
    // names all relevant fields are properly validated.
    // This is a workaround, since shouldUpdate=true on a
    // FormItemWithInfo doesn't work for some reason.
    form.validateFields();
  }, [dataLayers]);

  const { runningJobs, startJob, mostRecentSuccessfulJob } = useStartAndPollJob({
    onSuccess() {
      Toast.success(
        "The computation of the largest segment id for this dataset has finished. Please reload the page to see it.",
      );
    },
    onFailure() {
      Toast.error(
        "The computation of the largest segment id for this dataset didn't finish properly.",
      );
    },
    initialJobKeyExtractor: (job) =>
      job.type === "find_largest_segment_id" && job.datasetName === dataset?.name
        ? (job.datasetName ?? "largest_segment_id")
        : null,
  });
  const activeJob = runningJobs[0];

  const startJobFn =
    dataset != null
      ? async () => {
          const job = await startFindLargestSegmentIdJob(dataset.id, layer.name);
          Toast.info(
            "A job was scheduled to compute the largest segment ID. It will be automatically updated for the dataset. You may close this tab now.",
          );
          return [job.datasetName ?? "largest_segment_id", job.id] as [string, string];
        }
      : null;

  return (
    <div
      style={{
        width: "100%",
        position: "relative",
      }}
    >
      {mayLayerBeRemoved && (
        <div style={{ position: "absolute", top: 12, right: 0, zIndex: 500 }}>
          <Tooltip title="Remove Layer">
            <Button shape="circle" icon={<DeleteOutlined />} onClick={() => onRemoveLayer(layer)} />
          </Tooltip>
        </div>
      )}
      <Row gutter={48}>
        <Col span={24} xl={12}>
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
                    form
                      .getFieldValue(["dataSource", "dataLayers"])
                      .filter((someLayer: APIDataLayer) => someLayer.name === value).length <= 1,
                  "Layer names must be unique.",
                ),
              },
            ]}
          >
            <Input
              // the name of a layer depends on the folder name in wkw. Therefore, don't allow
              // editing the layer name for wkw.
              disabled={layer.dataFormat === "wkw"}
              style={{
                width: 408,
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
              style={{ width: 408 }}
            >
              {getMags(layer).map((mag) => (
                <Select.Option key={mag.toString()} value={mag.toString()}>
                  {typeof mag === "number" ? mag : mag.join("-")}
                </Select.Option>
              ))}
            </Select>
          </FormItemWithInfo>
        </Col>
        <Col span={24} xl={12}>
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
                validator: (_rule, value) =>
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
            <div>
              <div style={{ display: "flex", alignItems: "end" }}>
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
                      validator: (_rule, value) =>
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
                      validator: (_rule, value) =>
                        value != null && value === 2 ** bitDepth - 1
                          ? Promise.reject(
                              new Error(
                                `The largest segmentation ID has already reached the maximum possible value of 2^${bitDepth}-1. Annotations of this dataset cannot create new segments.`,
                              ),
                            )
                          : Promise.resolve(),
                    },
                    {
                      warningOnly: true,
                      validator: (_rule, value) =>
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
                  <DelegatePropsToFirstChild>
                    <InputNumber
                      // @ts-ignore returning undefined does work without problems
                      parser={(value: string | undefined) => {
                        if (value == null || value === "") {
                          return undefined;
                        }
                        return Number.parseInt(value, 10);
                      }}
                    />
                    {dataset?.dataStore.jobsSupportedByAvailableWorkers.includes(
                      APIJobType.FIND_LARGEST_SEGMENT_ID,
                    ) ? (
                      <Button
                        type={mostRecentSuccessfulJob == null ? "primary" : "default"}
                        title={`${
                          activeJob != null ? "Scanning" : "Scan"
                        } the data to derive the value automatically`}
                        style={{ marginLeft: 8 }}
                        loading={activeJob != null}
                        disabled={activeJob != null || startJob == null}
                        onClick={
                          startJob != null && startJobFn != null
                            ? () => startJob(startJobFn)
                            : () => Promise.resolve()
                        }
                      >
                        Detect
                      </Button>
                    ) : (
                      <></>
                    )}
                  </DelegatePropsToFirstChild>
                </FormItemWithInfo>
              </div>
              {mostRecentSuccessfulJob && (
                <div style={{ marginTop: -6 }}>
                  Output of most recent job: {mostRecentSuccessfulJob.result}
                </div>
              )}
            </div>
          ) : null}
        </Col>
      </Row>
    </div>
  );
}

function DelegatePropsToFirstChild({ children, ...props }: { children: React.ReactElement[] }) {
  // This is a small helper function which allows us to pass two children two FormItemWithInfo
  // even though antd only demands one. We do this for better layouting.
  return (
    <>
      {React.cloneElement(children[0], props)}
      {children[1]}
    </>
  );
}
