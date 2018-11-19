// @flow
import { Form, Checkbox, Input, Select, Card, Button } from "antd";
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
import RecommendedConfigurationView from "admin/tasktype/recommended_configuration_view";

const FormItem = Form.Item;
const { Option } = Select;
const { TextArea } = Input;

const toJSON = json => JSON.stringify(json, null, "  ");

type Props = {
  taskTypeId: ?string,
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
      recommendedConfiguration: toJSON({
        clippingDistance: 500,
        clippingDistanceArbitrary: 60,
        displayCrosshair: true,
        displayScalebars: false,
        dynamicSpaceDirection: true,
        keyboardDelay: 0,
        moveValue: 500,
        moveValue3d: 600,
        mouseRotateValue: 0.001,
        newNodeNewTree: false,
        highlightCommentedNodes: false,
        overrideNodeRadius: true,
        particleSize: 5,
        rotateValue: 0.01,
        sphericalCapRadius: 500,
        tdViewDisplayPlanes: false,
        fourBit: false,
        interpolation: true,
        quality: 0,
        segmentationOpacity: 0,
        highlightHoveredCellId: false,
        zoom: 0.8,
        renderMissingDataBlack: false,
      }),
    };
    const taskType = this.props.taskTypeId ? await getTaskType(this.props.taskTypeId) : null;
    // Use merge which is deep _.extend
    // eslint-disable-next-line no-unused-vars
    const formValues = _.merge({}, defaultValues, taskType);
    this.props.form.setFieldsValue(formValues);

    if (taskType != null && taskType.recommendedConfiguration != null) {
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
        if (this.props.taskTypeId) {
          await updateTaskType(this.props.taskTypeId, formValues);
        } else {
          await createTaskType(formValues);
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
    const titlePrefix = this.props.taskTypeId ? "Update " : "Create";

    return (
      <div className="container">
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
