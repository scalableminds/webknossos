// @flow
import { Button, Card, Checkbox, Form, Input, Radio, Select } from "antd";
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
        preferredMode: null,
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
      if (!err) {
        const { recommendedConfiguration, ...rest } = formValues;
        const newTaskType = {
          ...rest,
          recommendedConfiguration: JSON.parse(recommendedConfiguration),
        };
        if (this.props.taskTypeId) {
          await updateTaskType(this.props.taskTypeId, newTaskType);
        } else {
          await createTaskType(newTaskType);
        }
        this.props.history.push("/taskTypes");
      }
    });
  };

  onChangeUseRecommendedConfiguration = (useRecommendedConfiguration: boolean) => {
    this.setState({ useRecommendedConfiguration });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const isEditingMode = this.props.taskTypeId != null;
    const titlePrefix = isEditingMode ? "Update " : "Create";

    return (
      <div className="container" style={{ maxWidth: 1600, margin: "0 auto" }}>
        <Card title={<h3>{titlePrefix} Task Type</h3>}>
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

            <FormItem label="Tracing Type">
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
                  this.props.form.getFieldValue("tracingType") === "skeleton" ? "block" : "none",
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
                {titlePrefix} Task Type
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );
  }
}

export default withRouter(Form.create()(TaskTypeCreateView));
