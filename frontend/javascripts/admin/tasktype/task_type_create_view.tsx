import { Button, Card, Checkbox, Form, Input, Radio, Select, InputNumber, Tooltip } from "antd";
import { syncValidator } from "types/validation";
import { InfoCircleOutlined } from "@ant-design/icons";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import React, { useEffect, useState } from "react";
import _ from "lodash";
import {
  APITaskType,
  TracingType,
  TracingTypeEnum,
  type APIAllowedMode,
  type APIResolutionRestrictions,
  type APITeam,
} from "types/api_flow_types";
import {
  getEditableTeams,
  createTaskType,
  updateTaskType,
  getTaskType,
} from "admin/admin_rest_api";
import RecommendedConfigurationView, {
  getDefaultRecommendedConfiguration,
} from "admin/tasktype/recommended_configuration_view";
import { useFetch } from "libs/react_helpers";
import { RuleObject } from "antd/es/form";
import { jsonStringify } from "libs/utils";

const RadioGroup = Radio.Group;
const FormItem = Form.Item;
const { TextArea } = Input;

type Props = {
  taskTypeId?: string | null | undefined;
  history: RouteComponentProps["history"];
};

type FormValues = {
  isResolutionRestricted: boolean;
  summary: string;
  teamId: string;
  description: string;
  tracingType: TracingType;
  settings: {
    somaClickingAllowed: boolean;
    branchPointsAllowed: boolean;
    volumeInterpolationAllowed: boolean;
    mergerMode: boolean;
    preferredMode?: APIAllowedMode;
    allowedModes: APIAllowedMode[];
    resolutionRestrictions: APIResolutionRestrictions;
  };
  recommendedConfiguration: string | undefined;
};

function isValidMagnification(_rule: RuleObject, value: number | undefined) {
  if (value && (Math.log(value) / Math.log(2)) % 1 === 0) {
    return Promise.resolve();
  } else {
    return Promise.reject(
      new Error("The resolution must be stated as a power of two (e.g., 1 or 2 or 4 or 8 ...)"),
    );
  }
}

function isMinimumMagnifactionLargerThenMaxRule(value: number | undefined, maxMag: number) {
  if (value && value <= maxMag) {
    return Promise.resolve();
  }
  return Promise.reject(
    new Error("The minimum resolution needs to be smaller then the maximum mag."),
  );
}
function isMaximumMagnificationSmallerThenMinRule(value: number | undefined, minMag: number) {
  if (value && value >= minMag) {
    return Promise.resolve();
  }
  return Promise.reject(
    new Error("The maximum resolution needs to be larger then the minimum mag."),
  );
}

function TaskTypeCreateView({ taskTypeId, history }: Props) {
  const [useRecommendedConfiguration, setUseRecommendedConfiguration] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(true);
  const [form] = Form.useForm<FormValues>();

  const teams = useFetch(
    async () => {
      const teams = await getEditableTeams();
      setIsFetchingData(false);
      return teams;
    },
    [],
    [],
  );

  useEffect(() => {
    applyDefaults();
  }, []);

  async function applyDefaults() {
    const taskType = taskTypeId ? await getTaskType(taskTypeId) : null;

    const defaultValues = {
      isResolutionRestricted: false,
      settings: {
        somaClickingAllowed: true,
        branchPointsAllowed: true,
        volumeInterpolationAllowed: false,
        mergerMode: false,
        resolutionRestrictions: {
          min: 1,
          max: 512,
        },
      },
      recommendedConfiguration: jsonStringify(getDefaultRecommendedConfiguration()),
    };

    // Use merge which is deep _.extend
    const defaultFormValues: Partial<FormValues> = _.merge({}, defaultValues, taskType);
    form.setFieldsValue(defaultFormValues);

    if (taskType?.recommendedConfiguration) {
      //  Only "activate" the recommended configuration checkbox if the existing task type contained one
      setUseRecommendedConfiguration(true);
      form.setFieldValue(
        ["recommendedConfiguration"],
        jsonStringify(taskType?.recommendedConfiguration),
      );
    }

    if (
      taskType?.settings.resolutionRestrictions.min ||
      taskType?.settings.resolutionRestrictions.max
    )
      form.setFieldValue(["isResolutionRestricted"], true);
  }

  async function onFinish(formValues: FormValues) {
    const {
      settings,
      teamId,
      recommendedConfiguration,
      isResolutionRestricted: _isResolutionRestricted,
      ...rest
    } = formValues;
    const teamName = teams.find((team) => team.id === teamId)!["name"];

    if (!settings) {
      return;
    }

    // FormItems which are not rendered/hidden are not serialized by onFinish
    // add them manually
    if (!settings.resolutionRestrictions) {
      settings.resolutionRestrictions = { min: undefined, max: undefined };
    }

    const newTaskType: Omit<APITaskType, "id" | "teamName"> = {
      ...rest,
      teamId,
      settings,
      recommendedConfiguration:
        recommendedConfiguration != null && useRecommendedConfiguration
          ? JSON.parse(recommendedConfiguration)
          : null,
    };

    if (taskTypeId) {
      const updatedTaskType = { ...newTaskType, id: taskTypeId, teamName, settings };
      await updateTaskType(taskTypeId, updatedTaskType);
    } else {
      await createTaskType(newTaskType);
    }

    history.push("/taskTypes");
  }

  function onChangeUseRecommendedConfiguration(useRecommendedConfiguration: boolean) {
    setUseRecommendedConfiguration(useRecommendedConfiguration);
  }

  const isEditingMode = taskTypeId != null;
  const titlePrefix = isEditingMode ? "Update" : "Create";
  return (
    <div
      className="container"
      style={{
        maxWidth: 1600,
        margin: "0 auto",
      }}
    >
      <Card title={<h3>{`${titlePrefix} Task Type`}</h3>}>
        <Form
          form={form}
          onFinish={onFinish}
          layout="vertical"
          initialValues={{
            tracingType: TracingTypeEnum.skeleton,
          }}
        >
          <FormItem
            name="summary"
            label="Summary"
            hasFeedback
            rules={[
              {
                required: true,
              },
              {
                min: 3,
              },
              {
                validator: syncValidator(
                  (value) => !value.includes(","),
                  "The summary must not contain commas.",
                ),
              },
            ]}
          >
            <Input />
          </FormItem>

          <FormItem
            name="teamId"
            label="Team"
            hasFeedback
            rules={[
              {
                required: true,
              },
            ]}
          >
            <Select
              allowClear
              showSearch
              placeholder="Select a Team"
              optionFilterProp="label"
              style={{
                width: "100%",
              }}
              loading={isFetchingData}
              options={teams.map((team: APITeam) => ({
                value: team.id,
                label: `${team.name}`,
              }))}
            />
          </FormItem>

          <FormItem
            name="description"
            label={
              <span>
                Description (
                <a href="https://markdown-it.github.io/" target="_blank" rel="noopener noreferrer">
                  Markdown enabled
                </a>
                )
              </span>
            }
            hasFeedback
            rules={[
              {
                required: true,
              },
            ]}
          >
            <TextArea rows={10} />
          </FormItem>

          <FormItem name="tracingType" label="Annotation Type">
            <RadioGroup>
              <Radio value="skeleton" disabled={isEditingMode}>
                Skeleton
              </Radio>
              <Radio value="volume" disabled={isEditingMode}>
                Volume
              </Radio>
              <Radio value="hybrid" disabled={isEditingMode}>
                Skeleton and Volume
              </Radio>
            </RadioGroup>
          </FormItem>

          <FormItem
            name={["settings", "allowedModes"]}
            label="Allowed Modes"
            hasFeedback
            rules={[
              {
                required: true,
              },
            ]}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="Select all Allowed Modes"
              optionFilterProp="label"
              style={{
                width: "100%",
              }}
              options={[
                {
                  value: "orthogonal",
                  label: "Orthogonal",
                },
                {
                  value: "oblique",
                  label: "Oblique",
                },
                {
                  value: "flight",
                  label: "Flight",
                },
              ]}
            />
          </FormItem>

          <FormItem name={["settings", "preferredMode"]} label="Preferred Mode" hasFeedback>
            <Select
              allowClear
              optionFilterProp="label"
              style={{
                width: "100%",
              }}
              options={[
                {
                  value: null,
                  label: "Any",
                },
                {
                  value: "orthogonal",
                  label: "Orthogonal",
                },
                {
                  value: "oblique",
                  label: "Oblique",
                },
                {
                  value: "flight",
                  label: "Flight",
                },
              ]}
            />
          </FormItem>

          <FormItem
            noStyle
            shouldUpdate={(prevValues, curValues) =>
              prevValues.tracingType !== curValues.tracingType
            }
          >
            {({ getFieldValue }) => (
              <div>
                {/* Skeleton-specific */}
                <div
                  style={{
                    // These form items are always emitted here and only their visibility
                    // is changed, since the values are always needed to create/edit
                    // a task type (its schema requires it even though the fields are
                    // irrelevant for volume-only tasks).
                    display:
                      getFieldValue(["tracingType"]) === TracingTypeEnum.volume ? "none" : "block",
                  }}
                >
                  <FormItem
                    name={["settings", "somaClickingAllowed"]}
                    label="Settings"
                    valuePropName="checked"
                  >
                    <Checkbox>Allow Single-node-tree mode (&quot;Soma clicking&quot;)</Checkbox>
                  </FormItem>

                  <FormItem name={["settings", "branchPointsAllowed"]} valuePropName="checked">
                    <Checkbox>Allow Branchpoints</Checkbox>
                  </FormItem>
                  <FormItem name={["settings", "mergerMode"]} valuePropName="checked">
                    <Checkbox>Merger Mode</Checkbox>
                  </FormItem>
                </div>

                {/* Volume-specific */}
                <div
                  style={{
                    // These form items are always emitted here and only their visibility
                    // is changed, since the values are always needed to create/edit
                    // a task type (its schema requires it even though the fields are
                    // irrelevant for skeleton-only tasks).
                    display:
                      getFieldValue(["tracingType"]) === TracingTypeEnum.skeleton
                        ? "none"
                        : "block",
                  }}
                >
                  <FormItem
                    name={["settings", "volumeInterpolationAllowed"]}
                    valuePropName="checked"
                  >
                    <Checkbox>
                      Allow Volume Interpolation
                      <Tooltip
                        title="When enabled, it suffices to only label every 2nd slice. The skipped slices will be filled automatically by interpolating between the labeled slices."
                        placement="right"
                      >
                        <InfoCircleOutlined />
                      </Tooltip>
                    </Checkbox>
                  </FormItem>
                </div>
              </div>
            )}
          </FormItem>

          <FormItem
            name={["isResolutionRestricted"]}
            valuePropName="checked"
            style={{
              marginBottom: 6,
            }}
          >
            <Checkbox disabled={isEditingMode}>
              Restrict Resolutions{" "}
              <Tooltip
                title="The resolutions should be specified as power-of-two numbers. For example, if users should only be able to annotate in the best and second best magnification, the minimum should be 1 and the maximum should be 2. The third and fourth resolutions can be addressed with 4 and 8."
                placement="right"
              >
                <InfoCircleOutlined />
              </Tooltip>
            </Checkbox>
          </FormItem>

          <FormItem
            noStyle
            shouldUpdate={(prevValues, curValues) =>
              !prevValues.isResolutionRestricted ||
              prevValues.isResolutionRestricted !== curValues.isResolutionRestricted
            }
          >
            {({ getFieldValue }) =>
              getFieldValue(["isResolutionRestricted"]) ? (
                <div
                  style={{
                    marginLeft: 24,
                  }}
                >
                  <FormItem
                    name={["settings", "resolutionRestrictions", "min"]}
                    hasFeedback
                    label="Minimum"
                    style={{
                      marginBottom: 6,
                    }}
                    rules={[
                      {
                        validator: isValidMagnification,
                      },
                      {
                        validator: (_rule, value) =>
                          isMinimumMagnifactionLargerThenMaxRule(
                            value,
                            getFieldValue(["settings", "resolutionRestrictions", "max"]),
                          ),
                      },
                    ]}
                  >
                    <InputNumber min={1} size="small" disabled={isEditingMode} />
                  </FormItem>
                  <FormItem
                    name={["settings", "resolutionRestrictions", "max"]}
                    hasFeedback
                    label="Maximum"
                    rules={[
                      {
                        validator: isValidMagnification,
                      },
                      {
                        validator: (_rule, value) =>
                          isMaximumMagnificationSmallerThenMinRule(
                            value,
                            getFieldValue(["settings", "resolutionRestrictions", "min"]),
                          ),
                      },
                    ]}
                  >
                    <InputNumber min={1} size="small" disabled={isEditingMode} />
                  </FormItem>
                </div>
              ) : null
            }
          </FormItem>

          <FormItem>
            <RecommendedConfigurationView
              form={form}
              enabled={useRecommendedConfiguration}
              onChangeEnabled={onChangeUseRecommendedConfiguration}
            />
          </FormItem>

          <FormItem>
            <Button type="primary" htmlType="submit">
              {`${titlePrefix} Task Type`}
            </Button>
          </FormItem>
        </Form>
      </Card>
    </div>
  );
}

export default withRouter<RouteComponentProps & Props, any>(TaskTypeCreateView);
