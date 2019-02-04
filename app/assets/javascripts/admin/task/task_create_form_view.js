// @flow
import {
  Row,
  Col,
  Form,
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
import { type RouterHistory, withRouter } from "react-router-dom";
import React from "react";
import _ from "lodash";

import type { APIDataset, APITaskType, APIProject, APIScript } from "admin/api_flow_types";
import type { BoundingBoxObject } from "oxalis/store";
import type { TaskCreationResponse } from "admin/task/task_create_bulk_view";
import { Vector3Input, Vector6Input } from "libs/vector_input";
import type { Vector6 } from "oxalis/constants";
import {
  getActiveDatasets,
  getProjects,
  getScripts,
  getTaskTypes,
  getTask,
  createTasks,
  createTaskFromNML,
  updateTask,
} from "admin/admin_rest_api";
import SelectExperienceDomain from "components/select_experience_domain";
import messages from "messages";

const FormItem = Form.Item;
const Option = Select.Option;
const RadioGroup = Radio.Group;

type Props = {
  form: Object,
  taskId: ?string,
  history: RouterHistory,
};

type State = {
  datasets: Array<APIDataset>,
  taskTypes: Array<APITaskType>,
  projects: Array<APIProject>,
  scripts: Array<APIScript>,
  isNMLSpecification: boolean,
  isUploading: boolean,
};

export function handleTaskCreationResponse(responses: Array<TaskCreationResponse>) {
  const successfulTasks = [];
  const failedTasks = [];

  responses.forEach((response: TaskCreationResponse, i: number) => {
    if (response.status === 200 && response.success) {
      successfulTasks.push(
        `${response.success.id},${response.success.creationInfo ||
          "null"},(${response.success.editPosition.join(",")}) \n`,
      );
    } else if (response.error) {
      failedTasks.push(`Line ${i}: ${response.error} \n`);
    }
  });

  Modal.info({
    title: `${successfulTasks.length} tasks were successfully created. ${
      failedTasks.length
    } tasks failed.`,
    content: (
      <div>
        {successfulTasks.length > 0 ? (
          <div>
            Successful Tasks:
            <pre>
              taskId,filename,position
              <br />
              {successfulTasks}
            </pre>
          </div>
        ) : null}
        {failedTasks.length > 0 ? (
          <div>
            Failed Tasks:
            <pre>{failedTasks}</pre>
          </div>
        ) : null}
      </div>
    ),
    width: 600,
  });
}

class TaskCreateFormView extends React.PureComponent<Props, State> {
  state = {
    datasets: [],
    taskTypes: [],
    projects: [],
    scripts: [],
    isNMLSpecification: false,
    isUploading: false,
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async fetchData() {
    const [datasets, projects, scripts, taskTypes] = await Promise.all([
      getActiveDatasets(),
      getProjects(),
      getScripts(),
      getTaskTypes(),
    ]);

    this.setState({ datasets, projects, scripts, taskTypes });
  }

  async applyDefaults() {
    if (this.props.taskId) {
      const task = await getTask(this.props.taskId);
      const defaultValues = Object.assign({}, task, {
        taskTypeId: task.type.id,
        boundingBox: task.boundingBox ? task.boundingBoxVec6 : null,
        scriptId: task.script ? task.script.id : null,
        openInstances: task.status.open,
      });
      const validFormValues = _.omitBy(defaultValues, _.isNull);
      // The task type is not needed for the form and leads to antd errors if it contains null values
      const { type, ...neededFormValues } = validFormValues;
      this.props.form.setFieldsValue(neededFormValues);
    }
  }

  transformBoundingBox(boundingBox: Vector6): BoundingBoxObject {
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
        formValues.boundingBox = formValues.boundingBox
          ? this.transformBoundingBox(formValues.boundingBox)
          : null;

        if (this.props.taskId != null) {
          // either update an existing task
          const confirmedTask = await updateTask(this.props.taskId, formValues);
          this.props.history.push(`/tasks/${confirmedTask.id}`);
        } else {
          this.setState({ isUploading: true });

          // or create a new one either from the form values or with an NML file
          let response;
          try {
            if (this.state.isNMLSpecification) {
              // Workaround: Antd replaces file objects in the formValues with a wrapper file
              // The original file object is contained in the originFileObj property
              // This is most likely not intentional and may change in a future Antd version
              formValues.nmlFiles = formValues.nmlFiles.map(
                wrapperFile => wrapperFile.originFileObj,
              );
              response = await createTaskFromNML(formValues);
            } else {
              response = await createTasks([formValues]);
            }
            handleTaskCreationResponse(response);
          } finally {
            this.setState({
              isUploading: false,
            });
          }
        }
      }
    });
  };

  normFile = e => {
    if (Array.isArray(e)) {
      return e;
    }
    return e && e.fileList;
  };

  isVolumeTaskType = (taskTypeId?: string): boolean => {
    const selectedTaskTypeId = taskTypeId || this.props.form.getFieldValue("taskTypeId");
    const selectedTaskType = this.state.taskTypes.find(
      taskType => taskType.id === selectedTaskTypeId,
    );
    return selectedTaskType != null ? selectedTaskType.tracingType === "volume" : false;
  };

  onChangeTaskType = (taskTypeId: string): boolean => {
    if (this.isVolumeTaskType(taskTypeId)) {
      this.setState({ isNMLSpecification: false });
    }
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const isEditingMode = this.props.taskId != null;
    const titleLabel = isEditingMode ? `Update Task ${this.props.taskId || ""}` : "Create Task";
    const instancesLabel = isEditingMode ? "Remaining Instances" : "Task Instances";

    const fullWidth = { width: "100%" };

    return (
      <div className="container" style={{ paddingTop: 20 }}>
        <Spin spinning={this.state.isUploading}>
          <Card title={<h3>{titleLabel}</h3>}>
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
                    disabled={isEditingMode}
                    onChange={this.onChangeTaskType}
                  >
                    {this.state.taskTypes.map((taskType: APITaskType) => (
                      <Option key={taskType.id} value={taskType.id}>
                        {taskType.summary}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <Row gutter={8}>
                <Col span={12}>
                  <FormItem label="Experience Domain" hasFeedback>
                    {getFieldDecorator("neededExperience.domain", {
                      rules: [{ required: true }],
                    })(
                      <SelectExperienceDomain
                        disabled={isEditingMode}
                        placeholder="Select an Experience Domain"
                        notFoundContent={messages["task.domain_does_not_exist"]}
                        width={100}
                      />,
                    )}
                  </FormItem>
                </Col>
                <Col span={12}>
                  <FormItem label="Experience Value" hasFeedback>
                    {getFieldDecorator("neededExperience.value", {
                      rules: [{ required: true }, { type: "number" }],
                    })(<InputNumber style={fullWidth} disabled={isEditingMode} />)}
                  </FormItem>
                </Col>
              </Row>

              <FormItem label={instancesLabel} hasFeedback>
                {getFieldDecorator("openInstances", {
                  rules: [{ required: true }, { type: "number" }],
                })(<InputNumber style={fullWidth} min={0} />)}
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
                    disabled={isEditingMode}
                  >
                    {this.state.projects.map((project: APIProject) => (
                      <Option key={project.id} value={project.name}>
                        {project.name}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <FormItem label="Script" hasFeedback>
                {getFieldDecorator("scriptId")(
                  <Select
                    showSearch
                    placeholder="Select a Script"
                    optionFilterProp="children"
                    style={fullWidth}
                    autoFocus
                    disabled={isEditingMode}
                  >
                    {this.state.scripts.map((script: APIScript) => (
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
                {getFieldDecorator("boundingBox")(<Vector6Input disabled={isEditingMode} />)}
              </FormItem>

              <FormItem label="Task Specification" hasFeedback>
                <RadioGroup
                  value={this.state.isNMLSpecification ? "nml" : "manual"}
                  onChange={(evt: SyntheticInputEvent<*>) =>
                    this.setState({ isNMLSpecification: evt.target.value === "nml" })
                  }
                  disabled={this.isVolumeTaskType()}
                >
                  <Radio value="manual" disabled={isEditingMode}>
                    Manually Specify Starting Postion
                  </Radio>
                  <Radio value="nml" disabled={isEditingMode}>
                    Upload NML File
                  </Radio>
                </RadioGroup>
              </FormItem>

              {this.state.isNMLSpecification ? (
                <FormItem label="NML Files" hasFeedback>
                  {getFieldDecorator("nmlFiles", {
                    rules: [{ required: true }],
                    valuePropName: "fileList",
                    getValueFromEvent: this.normFile,
                  })(
                    <Upload.Dragger accept=".nml,.zip" name="nmlFiles" beforeUpload={() => false}>
                      <p className="ant-upload-drag-icon">
                        <Icon type="inbox" />
                      </p>
                      <p className="ant-upload-text">Click or Drag Files to This Area to Upload</p>
                      <p>
                        Every nml creates a new task. You can upload multiple NML files or zipped
                        collections of nml files (.zip).
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
                        disabled={isEditingMode}
                      >
                        {this.state.datasets.map((dataset: APIDataset) => (
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
                    })(<Vector3Input style={fullWidth} disabled={isEditingMode} />)}
                  </FormItem>

                  <FormItem label="Starting Rotation" hasFeedback>
                    {getFieldDecorator("editRotation", {
                      rules: [{ required: true }],
                      initialValue: [0, 0, 0],
                    })(<Vector3Input style={fullWidth} disabled={isEditingMode} />)}
                  </FormItem>
                </div>
              )}

              <FormItem>
                <Button type="primary" htmlType="submit">
                  {titleLabel}
                </Button>
              </FormItem>
            </Form>
          </Card>
        </Spin>
      </div>
    );
  }
}

export default withRouter(Form.create()(TaskCreateFormView));
