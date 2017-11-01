// @flow
import React from "react";
import {
  Form,
  Input,
  Select,
  Button,
  Card,
  Radio,
  Upload,
  Modal,
  Icon,
  InputNumber,
  Spin,
} from "antd";
import {
  getActiveDatasets,
  getProjects,
  getAdminTeams,
  getScripts,
  getTaskTypes,
  createTask,
  createTaskFromNML,
} from "admin/admin_rest_api";
import type {
  APIDatasetType,
  APITaskTypeType,
  APIProjectType,
  APIScriptType,
  APITeamType,
  APITaskType,
} from "admin/api_flow_types";
import type { BoundingBoxObjectType } from "oxalis/store";
import type { Vector6 } from "oxalis/constants";

import { Vector3Input, Vector6Input } from "libs/vector_input";

const FormItem = Form.Item;
const Option = Select.Option;
const RadioGroup = Radio.Group;

type Props = {
  form: Object,
};

type State = {
  datasets: Array<APIDatasetType>,
  taskTypes: Array<APITaskTypeType>,
  projects: Array<APIProjectType>,
  scripts: Array<APIScriptType>,
  teams: Array<APITeamType>,
  responseItems: Array<APITaskType>,
  isNMLSpecification: boolean,
  isUploading: boolean,
  isResponseModalVisible: boolean,
};

export function handleTaskCreationResponse(
  responses: Array<{ status: number, success: ?APITaskType }>,
) {
  const successCount = responses.filter(item => item.status === 200).length;
  const errorCount = responses.length - successCount;
  const csvContent = responses
    .filter(item => item.status === 200)
    .map(
      // $FlowFixMe status == 200 means success
      ({ success: task }) => `${task.id},${task.creationInfo},(${task.editPosition.join(",")})`,
    )
    .join("\n");

  if (successCount > 0) {
    Modal.success({
      title: `${successCount} tasks were successfully created. ${errorCount} tasks failed.`,
      content: (
        <pre>
          taskId,filename,position<br />
          {csvContent}
        </pre>
      ),
      width: 600,
    });
  }
}

class TaskCreateFormView extends React.PureComponent<Props, State> {
  state = {
    datasets: [],
    taskTypes: [],
    projects: [],
    scripts: [],
    teams: [],
    responseItems: [],
    isNMLSpecification: false,
    isUploading: false,
    isResponseModalVisible: false,
  };
  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const [datasets, projects, teams, scripts, taskTypes] = await Promise.all([
      getActiveDatasets(),
      getProjects(),
      getAdminTeams(),
      getScripts(),
      getTaskTypes(),
    ]);
  }

  transformBoundingBox(boundingBox: Vector6): BoundingBoxObjectType {
    return {
      topLeft: [boundingBox[0] || 0, boundingBox[1] || 0, boundingBox[2] || 0],
      width: boundingBox[3] || 0,
      height: boundingBox[4] || 0,
      depth: boundingBox[5] || 0,
    };
  }

  handleSubmit = e => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        formValues.status.inProgress = 0;
        formValues.status.completed = 0;
        formValues.boundingBox = formValues.boundingBox
          ? this.transformBoundingBox(formValues.boundingBox)
          : null;

        this.setState({ isUploading: true });

        let response;
        try {
          if (this.state.isNMLSpecification) {
            response = await createTaskFromNML(formValues);
          } else {
            response = await createTask(formValues);
          }
          handleTaskCreationResponse(response.items);
        } finally {
          this.setState({
            isUploading: false,
          });
        }

        // if (this..isEditingMode) {
        //   app.router.loadURL("/tasks");
        // } else {
        //   this.parent.showSaveSuccess(response);
        // }
      }
    });
  };

  normFile = e => {
    if (Array.isArray(e)) {
      return e;
    }
    return e && e.fileList;
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const isEditingMode = true;
    const taskInstancesLabel = isEditingMode ? "Remaining Instances" : "Task Instances";

    const fullWidth = { width: "100%" };

    return (
      <div className="container wide" style={{ paddingTop: 20 }}>
        <Spin spinning={this.state.isUploading}>
          <Card title={<h3>Create Task</h3>}>
            <Form onSubmit={this.handleSubmit} layout="vertical">
              <FormItem label="TaskType" hasFeedback>
                {getFieldDecorator("taskTypeId", {
                  rules: [{ required: true }],
                })(
                  <Select
                    showSearch
                    placeholder="Select a TaskType"
                    optionFilterProp="children"
                    style={fullWidth}
                    autoFocus
                  >
                    {this.state.taskTypes.map((taskType: APITaskTypeType) => (
                      <Option key={taskType.id} value={taskType.id}>
                        {taskType.summary}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <FormItem label="Experience Domain" hasFeedback>
                {getFieldDecorator("neededExperience.domain", {
                  rules: [{ required: true }, { min: 3 }],
                })(<Input />)}
              </FormItem>

              <FormItem label="Experience Value" hasFeedback>
                {getFieldDecorator("neededExperience.value", {
                  rules: [{ required: true }],
                })(<InputNumber style={fullWidth} />)}
              </FormItem>

              <FormItem label={taskInstancesLabel} hasFeedback>
                {getFieldDecorator("status.open", {
                  rules: [{ required: true }, { type: "number" }],
                })(<InputNumber style={fullWidth} />)}
              </FormItem>

              <FormItem label="Team" hasFeedback>
                {getFieldDecorator("team", {
                  rules: [{ required: true }],
                })(
                  <Select
                    showSearch
                    placeholder="Select a Team"
                    optionFilterProp="children"
                    style={fullWidth}
                    autoFocus
                  >
                    {this.state.teams.map((team: APITeamType) => (
                      <Option key={team.id} value={team.name}>
                        {team.name}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <FormItem label="Project" hasFeedback>
                {getFieldDecorator("projectName", {
                  rules: [{ required: true }],
                })(
                  <Select
                    showSearch
                    placeholder="Select a Project"
                    optionFilterProp="children"
                    style={fullWidth}
                    autoFocus
                  >
                    {this.state.projects.map((project: APIProjectType) => (
                      <Option key={project.id} value={project.name}>
                        {project.name}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <FormItem label="Script" hasFeedback>
                {getFieldDecorator("scriptId", {
                  rules: [{ required: true }],
                })(
                  <Select
                    showSearch
                    placeholder="Select a Project"
                    optionFilterProp="children"
                    style={fullWidth}
                    autoFocus
                  >
                    {this.state.scripts.map((script: APIScriptType) => (
                      <Option key={script.id} value={script.id}>
                        {script.name}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <FormItem
                label="Bounding Box"
                extra="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
                hasFeedback
              >
                {getFieldDecorator("boundingBox")(
                  // $FlowFixMe VectorComponent expects value + onChange props which will be set automatically by the form
                  <Vector6Input />,
                )}
              </FormItem>

              <FormItem label="Task Specification" hasFeedback>
                <RadioGroup
                  value={this.state.isNMLSpecification ? "nml" : "manual"}
                  onChange={(evt: SyntheticInputEvent<*>) =>
                    this.setState({ isNMLSpecification: evt.target.value === "nml" })}
                >
                  <Radio value="manual">Manually Specify Starting Postion</Radio>
                  <Radio value="nml">Upload NML File</Radio>
                </RadioGroup>
              </FormItem>

              {this.state.isNMLSpecification ? (
                <FormItem label="NML File" hasFeedback>
                  {getFieldDecorator("nmlFile", {
                    rules: [{ required: true }],
                    valuePropName: "fileList",
                    getValueFromEvent: this.normFile,
                  })(
                    <Upload.Dragger
                      accept=".nml,.zip"
                      name="nmlFile"
                      beforeUpload={file => {
                        this.props.form.setFieldsValue({ nmlFile: [file] });
                        return false;
                      }}
                    >
                      <p className="ant-upload-drag-icon">
                        <Icon type="inbox" />
                      </p>
                      <p className="ant-upload-text">Click or Drag File to This Area to Upload</p>
                      <p>
                        Every nml creates a new task. You can either upload a single NML file or a
                        zipped collection of nml files (.zip).
                      </p>
                    </Upload.Dragger>,
                  )}
                </FormItem>
              ) : (
                <div>
                  <FormItem label="Dataset" hasFeedback>
                    {getFieldDecorator("dataSet", {
                      rules: [{ required: true }],
                    })(
                      <Select
                        showSearch
                        placeholder="Select a Dataset"
                        optionFilterProp="children"
                        style={fullWidth}
                        autoFocus
                      >
                        {this.state.datasets.map((dataset: APIDatasetType) => (
                          <Option key={dataset.name} value={dataset.name}>
                            {dataset.name}
                          </Option>
                        ))}
                      </Select>,
                    )}
                  </FormItem>

                  <FormItem label="Starting Position" hasFeedback>
                    {getFieldDecorator("editPosition", {
                      rules: [{ required: true }],
                      initialValue: [0, 0, 0],
                      // $FlowFixMe VectorComponent expects value + onChange props which will be set automatically by the form
                    })(<Vector3Input style={fullWidth} />)}
                  </FormItem>

                  <FormItem label="Starting Rotation" hasFeedback>
                    {getFieldDecorator("editRotation", {
                      rules: [{ required: true }],
                      initialValue: [0, 0, 0],
                      // $FlowFixMe VectorComponent expects value + onChange props which will be set automatically by the form
                    })(<Vector3Input style={fullWidth} />)}
                  </FormItem>
                </div>
              )}

              <FormItem>
                <Button type="primary" htmlType="submit">
                  Create Task
                </Button>
              </FormItem>
            </Form>
          </Card>
        </Spin>
      </div>
    );
  }
}

export default Form.create()(TaskCreateFormView);
