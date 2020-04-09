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
  Icon,
  Tooltip,
} from "antd";
import { type RouterHistory, withRouter } from "react-router-dom";
import React from "react";
import _ from "lodash";

import type { APITeam } from "admin/api_flow_types";
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
const { Option } = Select;
const { TextArea } = Input;

type Props = {
  taskTypeId?: ?string,
  form: Object,
  history: RouterHistory,
};

type State = {
  teams: Array<APITeam>,
  useRecommendedConfiguration: boolean,
};

function isValidMagnification(rule, value, callback) {
  if (value === "" || value == null || (Math.log(value) / Math.log(2)) % 1 === 0) {
    callback();
  } else {
    callback("The magnification must be stated as a power of two (e.g., 1 or 2 or 4 or 8 ...)");
  }
}

function getMagnificationAdaptedSettings(rawSettings) {
  const { allowedMagnifications, ...settingsWithoutMagnifications } = rawSettings;

  if (
    allowedMagnifications.shouldRestrict &&
    allowedMagnifications.min != null &&
    allowedMagnifications.max != null &&
    allowedMagnifications.min > allowedMagnifications.max
  ) {
    Toast.error("Minimum magnification must not be greater than maximum magnification.");
    return null;
  }

  return {
    ...settingsWithoutMagnifications,
    allowedMagnifications,
  };
}

class TaskTypeCreateView extends React.PureComponent<Props, State> {
  state = {
    teams: [],
    useRecommendedConfiguration: false,
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
        allowedMagnifications: {
          shouldRestrict: false,
          min: 1,
          max: 512,
        },
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
    formValues.settings.allowedMagnificationsmin = formValues.settings.allowedMagnifications.min;
    formValues.settings.allowedMagnificationsmax = formValues.settings.allowedMagnifications.max;

    this.props.form.setFieldsValue(formValues);

    if (taskType != null && taskType.recommendedConfiguration != null) {
      // Only "activate" the recommended configuration checkbox if the existing task type contained one
      this.setState({ useRecommendedConfiguration: true });
    }
  }

  async fetchData() {
    this.setState({ teams: await getEditableTeams() });
  }

  handleSubmit = e => {
    e.preventDefault();
    if (!this.state.useRecommendedConfiguration) {
      this.props.form.setFieldsValue({ recommendedConfiguration: null });
    }
    this.props.form.validateFields(async (err, formValues) => {
      if (err) {
        Toast.error("Please check the form for errors.");
        return;
      }
      const { recommendedConfiguration, settings: rawSettings, ...rest } = formValues;

      const settings = getMagnificationAdaptedSettings(rawSettings);
      if (!settings) {
        return;
      }

      const newTaskType = {
        ...rest,
        settings,
        recommendedConfiguration: JSON.parse(recommendedConfiguration),
      };
      if (this.props.taskTypeId) {
        await updateTaskType(this.props.taskTypeId, newTaskType);
      } else {
        await createTaskType(newTaskType);
      }
      this.props.history.push("/taskTypes");
    });
  };

  onChangeUseRecommendedConfiguration = (useRecommendedConfiguration: boolean) => {
    this.setState({ useRecommendedConfiguration });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const isEditingMode = this.props.taskTypeId != null;
    const titlePrefix = isEditingMode ? "Update" : "Create";

    return (
      <div className="container" style={{ maxWidth: 1600, margin: "0 auto" }}>
        <Card title={<h3>{`${titlePrefix} Task Type`}</h3>}>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="Summary" hasFeedback>
              {getFieldDecorator("summary", {
                rules: [
                  {
                    required: true,
                  },
                  { min: 3 },
                ],
              })(<Input />)}
            </FormItem>

            <FormItem label="Team" hasFeedback>
              {getFieldDecorator("teamId", {
                rules: [{ required: true }],
              })(
                <Select
                  allowClear
                  showSearch
                  placeholder="Select a Team"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                >
                  {this.state.teams.map((team: APITeam) => (
                    <Option key={team.id} value={team.id}>
                      {`${team.name}`}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem
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
            >
              {getFieldDecorator("description", {
                rules: [{ required: true }],
              })(<TextArea rows={10} />)}
            </FormItem>

            <FormItem label="Annotation Type">
              {getFieldDecorator("tracingType", {
                initialValue: "skeleton",
              })(
                <RadioGroup>
                  <Radio value="skeleton" disabled={isEditingMode}>
                    Skeleton
                  </Radio>
                  <Radio value="volume" disabled={isEditingMode}>
                    Volume
                  </Radio>
                  <Radio value="hybrid" disabled={isEditingMode}>
                    Hybrid
                  </Radio>
                </RadioGroup>,
              )}
            </FormItem>

            <FormItem label="Allowed Modes" hasFeedback>
              {getFieldDecorator("settings.allowedModes", {
                rules: [{ required: true }],
              })(
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="Select all Allowed Modes"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                >
                  <Option value="orthogonal">Orthogonal</Option>
                  <Option value="oblique">Oblique</Option>
                  <Option value="flight">Flight</Option>
                </Select>,
              )}
            </FormItem>

            <FormItem label="Preferred Mode" hasFeedback>
              {getFieldDecorator("settings.preferredMode")(
                <Select allowClear optionFilterProp="children" style={{ width: "100%" }}>
                  <Option value={null}>Any</Option>
                  <Option value="orthogonal">Orthogonal</Option>
                  <Option value="oblique">Oblique</Option>
                  <Option value="flight">Flight</Option>
                </Select>,
              )}
            </FormItem>

            <div
              style={{
                display:
                  this.props.form.getFieldValue("tracingType") === "volume" ? "none" : "block",
              }}
            >
              <FormItem label="Settings">
                {getFieldDecorator("settings.somaClickingAllowed", {
                  valuePropName: "checked",
                })(<Checkbox>Allow Single-node-tree mode (&quot;Soma clicking&quot;)</Checkbox>)}
              </FormItem>

              <FormItem>
                {getFieldDecorator("settings.branchPointsAllowed", {
                  valuePropName: "checked",
                })(<Checkbox>Allow Branchpoints</Checkbox>)}
              </FormItem>

              <FormItem>
                {getFieldDecorator("settings.mergerMode", {
                  valuePropName: "checked",
                })(<Checkbox>Merger Mode</Checkbox>)}
              </FormItem>
            </div>

            <FormItem style={{ marginBottom: 6 }}>
              {getFieldDecorator("settings.allowedMagnifications.shouldRestrict", {
                valuePropName: "checked",
              })(
                <Checkbox>
                  Restrict Magnifications{" "}
                  <Tooltip
                    title="The magnifications should be specified as power-of-two numbers. For example, if users should only be able to trace in the best and second best magnification, the minimum should be 1 and the maximum should be 2. The third and fourth magnifications can be addressed with 4 and 8."
                    placement="right"
                  >
                    <Icon type="info-circle" />
                  </Tooltip>
                </Checkbox>,
              )}
            </FormItem>

            <div
              style={{
                marginLeft: 24,
                display: this.props.form.getFieldValue(
                  "settings.allowedMagnifications.shouldRestrict",
                )
                  ? "block"
                  : "none",
              }}
            >
              <div>
                <FormItem hasFeedback style={{ marginBottom: 6 }}>
                  Minimum:{" "}
                  {getFieldDecorator("settings.allowedMagnifications.min", {
                    rules: [{ validator: isValidMagnification }],
                  })(<InputNumber min={1} size="small" />)}
                </FormItem>
              </div>
              <div>
                <FormItem hasFeedback>
                  Maximum:{" "}
                  {getFieldDecorator("settings.allowedMagnifications.max", {
                    rules: [{ validator: isValidMagnification }],
                  })(<InputNumber min={1} size="small" />)}
                </FormItem>
              </div>
            </div>

            <FormItem>
              <RecommendedConfigurationView
                form={this.props.form}
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

export default withRouter(Form.create()(TaskTypeCreateView));
