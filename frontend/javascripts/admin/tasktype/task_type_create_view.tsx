import { Button, Card, Checkbox, Form, Input, Radio, Select, InputNumber, Tooltip } from "antd";
import { syncValidator } from "types/validation";
import { FormInstance } from "antd/lib/form";
import { InfoCircleOutlined } from "@ant-design/icons";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import React from "react";
import _ from "lodash";
import messages from "messages";
import type { APITeam } from "types/api_flow_types";
import {
  getEditableTeams,
  createTaskType,
  updateTaskType,
  getTaskType,
} from "admin/admin_rest_api";
import { jsonStringify } from "libs/utils";
import RecommendedConfigurationView, {
  getDefaultRecommendedConfiguration,
} from "admin/tasktype/recommended_configuration_view";
import Toast from "libs/toast";
const RadioGroup = Radio.Group;
const FormItem = Form.Item;
const { TextArea } = Input;
type Props = {
  taskTypeId?: string | null | undefined;
  history: RouteComponentProps["history"];
};
type State = {
  teams: Array<APITeam>;
  useRecommendedConfiguration: boolean;
  isFetchingData: boolean;
};

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'rule' implicitly has an 'any' type.
function isValidMagnification(_rule, value) {
  if (value === "" || value == null || (Math.log(value) / Math.log(2)) % 1 === 0) {
    return Promise.resolve();
  } else {
    return Promise.reject(
      new Error("The resolution must be stated as a power of two (e.g., 1 or 2 or 4 or 8 ...)"),
    );
  }
}

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'rawSettings' implicitly has an 'any' ty... Remove this comment to see the full error message
function getMagnificationAdaptedSettings(rawSettings) {
  const { resolutionRestrictionsForm, ...settingsWithoutMagnifications } = rawSettings;
  const resolutionRestrictions = {
    min: resolutionRestrictionsForm.shouldRestrict ? resolutionRestrictionsForm.min : null,
    max: resolutionRestrictionsForm.shouldRestrict ? resolutionRestrictionsForm.max : null,
  };

  if (
    resolutionRestrictions.min != null &&
    resolutionRestrictions.max != null &&
    resolutionRestrictions.min > resolutionRestrictions.max
  ) {
    Toast.error("Minimum resolution must not be greater than maximum resolution.");
    return null;
  }

  return { ...settingsWithoutMagnifications, resolutionRestrictions };
}

class TaskTypeCreateView extends React.PureComponent<Props, State> {
  formRef = React.createRef<FormInstance>();
  state: State = {
    teams: [],
    useRecommendedConfiguration: false,
    isFetchingData: false,
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async applyDefaults() {
    const taskType = this.props.taskTypeId ? await getTaskType(this.props.taskTypeId) : null;
    const hasRecommendedConfiguration = taskType?.recommendedConfiguration != null;
    const defaultValues = {
      settings: {
        somaClickingAllowed: true,
        branchPointsAllowed: true,
        volumeInterpolationAllowed: false,
        mergerMode: false,
        preferredMode: null,
        resolutionRestrictions: {},
      },
      recommendedConfiguration: hasRecommendedConfiguration
        ? {}
        : getDefaultRecommendedConfiguration(),
    };

    // Use merge which is deep _.extend
    const formValues = _.merge({}, defaultValues, taskType);

    if (!hasRecommendedConfiguration) {
      // A recommended configuration of null overrides the default configuration when using _.merge
      // If the task type has no recommended configuration, suggest the default one
      formValues.recommendedConfiguration = defaultValues.recommendedConfiguration;
    }

    // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'recommendedConfiguration' becaus... Remove this comment to see the full error message
    formValues.recommendedConfiguration = jsonStringify(formValues.recommendedConfiguration);
    // The format of settings.resolutionRestrictions does not match the form precisely.
    // It is replaced here by resolutionRestrictionsForm, wich has a shouldRestrict boolean
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolutionRestrictionsForm' does not exi... Remove this comment to see the full error message
    formValues.settings.resolutionRestrictionsForm = {
      shouldRestrict:
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolutionRestrictions' does not exist o... Remove this comment to see the full error message
        formValues.settings.resolutionRestrictions.min != null ||
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolutionRestrictions' does not exist o... Remove this comment to see the full error message
        formValues.settings.resolutionRestrictions.max != null,
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolutionRestrictions' does not exist o... Remove this comment to see the full error message
      min: formValues.settings.resolutionRestrictions.min || 1,
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolutionRestrictions' does not exist o... Remove this comment to see the full error message
      max: formValues.settings.resolutionRestrictions.max || 512,
    };
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'resolutionRestrictions' does not exist o... Remove this comment to see the full error message
    delete formValues.settings.resolutionRestrictions;
    const form = this.formRef.current;

    if (!form) {
      Toast.info(messages["ui.no_form_active"]);
      return;
    }

    form.setFieldsValue(formValues);

    if (taskType?.recommendedConfiguration != null) {
      // Only "activate" the recommended configuration checkbox if the existing task type contained one
      this.setState({
        useRecommendedConfiguration: true,
      });
    }
  }

  async fetchData() {
    this.setState({
      isFetchingData: true,
    });
    const editableTeams = await getEditableTeams();
    this.setState({
      teams: editableTeams,
      isFetchingData: false,
    });
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  onFinish = async (formValues) => {
    if (!this.state.useRecommendedConfiguration) {
      formValues.recommendedConfiguration = null;
    }

    const { recommendedConfiguration, settings: rawSettings, ...rest } = formValues;
    const settings = getMagnificationAdaptedSettings(rawSettings);

    if (!settings) {
      return;
    }

    const newTaskType = {
      ...rest,
      settings,
      recommendedConfiguration:
        recommendedConfiguration != null ? JSON.parse(recommendedConfiguration) : null,
    };

    if (this.props.taskTypeId) {
      await updateTaskType(this.props.taskTypeId, newTaskType);
    } else {
      await createTaskType(newTaskType);
    }

    this.props.history.push("/taskTypes");
  };

  onChangeUseRecommendedConfiguration = (useRecommendedConfiguration: boolean) => {
    this.setState({
      useRecommendedConfiguration,
    });
  };

  render() {
    const form = this.formRef.current;
    const isEditingMode = this.props.taskTypeId != null;
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
            onFinish={this.onFinish}
            layout="vertical"
            ref={this.formRef}
            initialValues={{
              tracingType: "skeleton",
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
                loading={this.state.isFetchingData}
                options={this.state.teams.map((team: APITeam) => ({
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
                  <a
                    href="https://markdown-it.github.io/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
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
                      display: getFieldValue(["tracingType"]) === "volume" ? "none" : "block",
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
                      display: getFieldValue(["tracingType"]) === "skeleton" ? "none" : "block",
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
              name={["settings", "resolutionRestrictionsForm", "shouldRestrict"]}
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
                !prevValues.settings ||
                prevValues.settings.resolutionRestrictionsForm.shouldRestrict !==
                  curValues.settings.resolutionRestrictionsForm.shouldRestrict
              }
            >
              {({ getFieldValue }) =>
                getFieldValue(["settings", "resolutionRestrictionsForm", "shouldRestrict"]) ? (
                  <div
                    style={{
                      marginLeft: 24,
                    }}
                  >
                    <FormItem
                      name={["settings", "resolutionRestrictionsForm", "min"]}
                      hasFeedback
                      label="Minimum"
                      style={{
                        marginBottom: 6,
                      }}
                      rules={[
                        {
                          validator: isValidMagnification,
                        },
                      ]}
                    >
                      <InputNumber min={1} size="small" disabled={isEditingMode} />
                    </FormItem>
                    <FormItem
                      name={["settings", "resolutionRestrictionsForm", "max"]}
                      hasFeedback
                      label="Maximum"
                      rules={[
                        {
                          validator: isValidMagnification,
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
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'FormInstance<any> | null' is not assignable ... Remove this comment to see the full error message
                form={form}
                enabled={this.state.useRecommendedConfiguration}
                onChangeEnabled={this.onChangeUseRecommendedConfiguration}
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
}

export default withRouter<RouteComponentProps & Props, any>(TaskTypeCreateView);
