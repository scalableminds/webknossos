// @flow
import {
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Radio,
  Select,
  InputNumber,
  Tooltip,
  Spin,
} from "antd";
import { FormInstance } from "antd/lib/form";
import { InfoCircleOutlined } from "@ant-design/icons";
import { type RouterHistory, withRouter } from "react-router-dom";
import React from "react";
import _ from "lodash";

import type { APITeam } from "types/api_flow_types";
import {
  getEditableTeams,
  createTaskType,
  updateTaskType,
  getTaskType,
} from "admin/admin_rest_api";
import { jsonStringify } from "libs/utils";
import RecommendedConfigurationView, {
  DEFAULT_RECOMMENDED_CONFIGURATION,
} from "admin/tasktype/recommended_configuration_view";
import Toast from "libs/toast";

const RadioGroup = Radio.Group;

const FormItem = Form.Item;
const { TextArea } = Input;

type Props = {
  taskTypeId?: ?string,
  history: RouterHistory,
};

type State = {
  teams: Array<APITeam>,
  useRecommendedConfiguration: boolean,
  isFetchingData: boolean,
};

function isValidMagnification(rule, value) {
  if (value === "" || value == null || (Math.log(value) / Math.log(2)) % 1 === 0) {
    return Promise.resolve();
  } else {
    return Promise.reject(
      new Error("The resolution must be stated as a power of two (e.g., 1 or 2 or 4 or 8 ...)"),
    );
  }
}

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

  return {
    ...settingsWithoutMagnifications,
    resolutionRestrictions,
  };
}

class TaskTypeCreateView extends React.PureComponent<Props, State> {
  formRef = React.createRef<typeof FormInstance>();
  state = {
    teams: [],
    useRecommendedConfiguration: false,
    isFetchingData: false,
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async applyDefaults() {
    const defaultValues = {
      settings: {
        somaClickingAllowed: true,
        branchPointsAllowed: true,
        mergerMode: false,
        preferredMode: null,
        resolutionRestrictions: {},
      },
      recommendedConfiguration: DEFAULT_RECOMMENDED_CONFIGURATION,
    };
    const taskType = this.props.taskTypeId ? await getTaskType(this.props.taskTypeId) : null;
    // Use merge which is deep _.extend
    const formValues = _.merge({}, defaultValues, taskType);
    if (formValues.recommendedConfiguration == null) {
      // A recommended configuration of null overrides the default configuration when using _.merge
      // If the task type has no recommended configuration, suggest the default one
      formValues.recommendedConfiguration = defaultValues.recommendedConfiguration;
    }
    formValues.recommendedConfiguration = jsonStringify(formValues.recommendedConfiguration);
    // The format of settings.resolutionRestrictions does not match the form precisely.
    // It is replaced here by resolutionRestrictionsForm, wich has a shouldRestrict boolean
    formValues.settings.resolutionRestrictionsForm = {
      shouldRestrict:
        formValues.settings.resolutionRestrictions.min != null ||
        formValues.settings.resolutionRestrictions.max != null,
      min: formValues.settings.resolutionRestrictions.min || 1,
      max: formValues.settings.resolutionRestrictions.max || 512,
    };
    delete formValues.settings.resolutionRestrictions;

    const form = this.formRef.current;
    if (!form) {
      return;
    }
    form.setFieldsValue(formValues);

    if (taskType != null && taskType.recommendedConfiguration != null) {
      // Only "activate" the recommended configuration checkbox if the existing task type contained one
      this.setState({ useRecommendedConfiguration: true });
    }
  }

  async fetchData() {
    this.setState({ isFetchingData: true });
    const editableTeams = await getEditableTeams();
    this.setState({ teams: editableTeams, isFetchingData: false });
  }

  handleSubmit = async formValues => {
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
    this.setState({ useRecommendedConfiguration });
  };

  render() {
    const form = this.formRef.current;
    const isEditingMode = this.props.taskTypeId != null;
    const titlePrefix = isEditingMode ? "Update" : "Create";

    return (
      <div className="container" style={{ maxWidth: 1600, margin: "0 auto" }}>
        <Card title={<h3>{`${titlePrefix} Task Type`}</h3>}>
          <Form
            onFinish={this.handleSubmit}
            layout="vertical"
            ref={this.formRef}
            initialValues={{ tracingType: "skeleton" }}
          >
            <FormItem
              name="summary"
              label="Summary"
              hasFeedback
              rules={[{ required: true }, { min: 3 }]}
            >
              <Input />
            </FormItem>

            <FormItem name="teamId" label="Team" hasFeedback rules={[{ required: true }]}>
              <Select
                allowClear
                showSearch
                placeholder="Select a Team"
                optionFilterProp="children"
                style={{ width: "100%" }}
                notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
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
              rules={[{ required: true }]}
            >
              <TextArea rows={10} />
            </FormItem>

            <FormItem
              name="tracingType"
              label="Annotation Type"
              onChange={() => this.forceUpdate()}
            >
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
              rules={[{ required: true }]}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Select all Allowed Modes"
                optionFilterProp="children"
                style={{ width: "100%" }}
                options={[
                  { value: "orthogonal", label: "Orthogonal" },
                  { value: "oblique", label: "Oblique" },
                  { value: "flight", label: "Flight" },
                ]}
              />
            </FormItem>

            <FormItem name={["settings", "preferredMode"]} label="Preferred Mode" hasFeedback>
              <Select
                allowClear
                optionFilterProp="children"
                style={{ width: "100%" }}
                options={[
                  { value: null, label: "Any" },
                  { value: "orthogonal", label: "Orthogonal" },
                  { value: "oblique", label: "Oblique" },
                  { value: "flight", label: "Flight" },
                ]}
              />
            </FormItem>

            <FormItem
              noStyle
              shouldUpdate={(prevValues, curValues) =>
                prevValues.tracingType !== curValues.tracingType
              }
            >
              {({ getFieldValue }) =>
                getFieldValue(["tracingType"]) !== "volume" ? (
                  <React.Fragment>
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
                  </React.Fragment>
                ) : null
              }
            </FormItem>

            <FormItem
              name={["settings", "resolutionRestrictionsForm", "shouldRestrict"]}
              valuePropName="checked"
              style={{ marginBottom: 6 }}
            >
              <Checkbox disabled={isEditingMode}>
                Restrict Resolutions{" "}
                <Tooltip
                  title="The resolutions should be specified as power-of-two numbers. For example, if users should only be able to trace in the best and second best magnification, the minimum should be 1 and the maximum should be 2. The third and fourth resolutions can be addressed with 4 and 8."
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
                  <div style={{ marginLeft: 24 }}>
                    <FormItem
                      name={["settings", "resolutionRestrictionsForm", "min"]}
                      hasFeedback
                      label="Minimum"
                      style={{ marginBottom: 6 }}
                      rules={[{ validator: isValidMagnification }]}
                    >
                      <InputNumber min={1} size="small" disabled={isEditingMode} />
                    </FormItem>
                    <FormItem
                      name={["settings", "resolutionRestrictionsForm", "max"]}
                      hasFeedback
                      label="Maximum"
                      rules={[{ validator: isValidMagnification }]}
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

export default withRouter(TaskTypeCreateView);
