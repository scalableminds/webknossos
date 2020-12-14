// @flow
import { Form, Input, Button, Card, Upload, Icon, Spin, Progress, Divider } from "antd";
import React from "react";
import _ from "lodash";

import type { APITask } from "types/api_flow_types";
import type { BoundingBoxObject } from "oxalis/store";
import type { Vector3 } from "oxalis/constants";
import { createTasks } from "admin/admin_rest_api";
import { handleTaskCreationResponse } from "admin/task/task_create_form_view";
import Messages from "messages";
import Toast from "libs/toast";

const FormItem = Form.Item;
const { TextArea } = Input;

const NUM_TASKS_PER_BATCH = 100;

type Props = {
  form: Object,
};

type State = {
  isUploading: boolean,
  tasksCount: number,
  tasksProcessed: number,
};

export type NewTask = {|
  +boundingBox: ?BoundingBoxObject,
  +dataSet: string,
  +editPosition: Vector3,
  +editRotation: Vector3,
  +neededExperience: {
    +domain: string,
    +value: number,
  },
  +projectName: string,
  +scriptId: ?string,
  +openInstances: number,
  +taskTypeId: string,
  +csvFile?: File,
  +nmlFiles?: File,
  +baseAnnotation?: ?{
    baseId: string,
  },
|};

export type TaskCreationResponse = {
  status: number,
  success?: APITask,
  error?: string,
};

export type TaskCreationResponseContainer = {
  tasks: Array<TaskCreationResponse>,
  warnings: Array<string>,
};

class TaskCreateBulkView extends React.PureComponent<Props, State> {
  state = {
    isUploading: false,
    tasksCount: 0,
    tasksProcessed: 0,
  };

  isValidData(bulkText): boolean {
    const tasks = this.parseText(bulkText);
    return tasks.every(this.isValidTask);
  }

  isValidTask(task: NewTask): boolean {
    const { boundingBox } = task;

    if (
      !_.isString(task.neededExperience.domain) ||
      !_.isString(task.dataSet) ||
      !_.isString(task.taskTypeId) ||
      !_.isString(task.projectName) ||
      task.editPosition.some(Number.isNaN) ||
      task.editRotation.some(Number.isNaN) ||
      Number.isNaN(task.openInstances) ||
      Number.isNaN(task.neededExperience.value) ||
      // Bounding Box is optional and can be null
      (boundingBox != null
        ? boundingBox.topLeft.some(Number.isNaN) ||
          Number.isNaN(boundingBox.width) ||
          Number.isNaN(boundingBox.height) ||
          Number.isNaN(boundingBox.depth) ||
          // is editPosition within the BoundingBox?
          task.editPosition[0] > boundingBox.topLeft[0] + boundingBox.width ||
          task.editPosition[0] < boundingBox.topLeft[0] ||
          task.editPosition[1] > boundingBox.topLeft[1] + boundingBox.height ||
          task.editPosition[1] < boundingBox.topLeft[1] ||
          task.editPosition[2] > boundingBox.topLeft[2] + boundingBox.depth ||
          task.editPosition[2] < boundingBox.topLeft[2]
        : false)
    ) {
      return false;
    }

    return true;
  }

  splitToLines(string: string): Array<string> {
    return string.trim().split("\n");
  }

  splitToWords(string: string): Array<string> {
    return string.split(",").map(word => word.trim());
  }

  parseText(bulkText: string): Array<NewTask> {
    return this.splitToLines(bulkText)
      .map(line => this.parseLine(line))
      .filter(task => task !== null);
  }

  parseLine(line: string): NewTask {
    const words = this.splitToWords(line);

    const dataSet = words[0];
    const taskTypeId = words[1];
    const experienceDomain = words[2];
    const minExperience = parseInt(words[3]);
    const x = parseInt(words[4]);
    const y = parseInt(words[5]);
    const z = parseInt(words[6]);
    const rotX = parseInt(words[7]);
    const rotY = parseInt(words[8]);
    const rotZ = parseInt(words[9]);
    const openInstances = parseInt(words[10]);
    const boundingBoxX = parseInt(words[11]);
    const boundingBoxY = parseInt(words[12]);
    const boundingBoxZ = parseInt(words[13]);
    const width = parseInt(words[14]);
    const height = parseInt(words[15]);
    const depth = parseInt(words[16]);
    const projectName = words[17];

    // mapOptional takes care of treating empty strings as null
    function mapOptional<U>(word, fn: string => U): ?U {
      return word != null && word !== "" ? fn(word) : undefined;
    }
    const scriptId = mapOptional(words[18], a => a);
    const baseAnnotation = mapOptional(words[19], word => ({ baseId: word }));

    // BoundingBox is optional and can be set to null by using the format [0, 0, 0, 0, 0, 0]
    const boundingBox =
      width <= 0 || height <= 0 || depth <= 0
        ? null
        : {
            topLeft: [boundingBoxX, boundingBoxY, boundingBoxZ],
            width,
            height,
            depth,
          };

    return {
      dataSet,
      taskTypeId,
      scriptId,
      openInstances,
      boundingBox,
      projectName,
      neededExperience: {
        value: minExperience,
        domain: experienceDomain,
      },
      editPosition: [x, y, z],
      editRotation: [rotX, rotY, rotZ],
      baseAnnotation,
    };
  }

  async readCSVFile(csvFile: File): Promise<Array<NewTask>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      // $FlowIssue[incompatible-call] reader.result is wrongfully typed as ArrayBuffer
      reader.onload = () => resolve(this.parseText(reader.result));
      reader.onerror = reject;
      reader.readAsText(csvFile);
    });
  }

  handleSubmit = async e => {
    e.preventDefault();

    let tasks;
    const formValues = this.props.form.getFieldsValue();

    if (formValues.csvFile) {
      // Workaround: Antd replaces file objects in the formValues with a wrapper file
      // The original file object is contained in the originFileObj property
      // This is most likely not intentional and may change in a future Antd version
      formValues.csvFile = formValues.csvFile.map(wrapperFile => wrapperFile.originFileObj);

      tasks = await this.readCSVFile(formValues.csvFile[0]);
    } else {
      tasks = this.parseText(formValues.bulkText);
    }
    if (tasks.every(this.isValidTask)) {
      this.batchUpload(tasks);
    } else {
      const invalidTaskIndices = this.getInvalidTaskIndices(tasks);
      Toast.error(
        `${Messages["task.bulk_create_invalid"]} Error in line ${invalidTaskIndices.join(", ")}`,
      );
    }
  };

  getInvalidTaskIndices(tasks: Array<NewTask>): Array<number> {
    // returns the index / line number of an invalidly parsed task
    // returned indicies start at 1 for easier matching by non-CS people
    const isValidTasks = tasks.map(this.isValidTask);
    const invalidTasks: Array<number> = [];
    return isValidTasks.reduce((result, isValid: boolean, i: number) => {
      if (!isValid) {
        result.push(i + 1);
      }
      return result;
    }, invalidTasks);
  }

  async batchUpload(tasks: Array<NewTask>) {
    // upload the tasks in batches to save the server from dying
    this.setState({
      isUploading: true,
      tasksCount: tasks.length,
      tasksProcessed: 0,
    });

    try {
      let taskResponses = [];
      let warnings = [];

      for (let i = 0; i < tasks.length; i += NUM_TASKS_PER_BATCH) {
        const subArray = tasks.slice(i, i + NUM_TASKS_PER_BATCH);
        // eslint-disable-next-line no-await-in-loop
        const response = await createTasks(subArray);
        taskResponses = taskResponses.concat(response.tasks);
        warnings = warnings.concat(response.warnings);
        this.setState({
          tasksProcessed: i + NUM_TASKS_PER_BATCH,
        });
      }

      handleTaskCreationResponse({ tasks: taskResponses, warnings: _.uniq(warnings) });
    } finally {
      this.setState({
        isUploading: false,
      });
    }
  }

  normFile = e => {
    if (Array.isArray(e)) {
      return e;
    }
    return e && e.fileList;
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <div className="container" style={{ paddingTop: 20 }}>
        <Spin spinning={this.state.isUploading}>
          <Card title={<h3>Bulk Create Tasks</h3>}>
            <p>
              Specify each new task on a separate line as comma seperated values (CSV) in the
              following format:
              <br />
              <a href="/dashboard">dataSet</a>, <a href="/taskTypes">taskTypeId</a>,{" "}
              experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances, minX, minY,{" "}
              minZ, width, height, depth, <a href="/projects">project</a> [,{" "}
              <a href="/scripts">scriptId</a>, baseAnnotationId]
              <br />
              If you want to define some (but not all) of the optional values, please list all
              optional values and use an empty value for the ones you do not want to set (e.g.,
              someValue,,someOtherValue if you want to omit the second value). If you do not want to
              define a bounding box, you may use 0, 0, 0, 0, 0, 0 for the corresponding values.
            </p>
            <Form onSubmit={this.handleSubmit} layout="vertical">
              <FormItem label="Bulk Task Specification" hasFeedback>
                {getFieldDecorator("bulkText", {
                  rules: [
                    {
                      validator: (rule, value, callback) => {
                        const tasks = this.parseText(value);
                        const invalidTaskIndices = this.getInvalidTaskIndices(tasks);

                        return _.isString(value) && invalidTaskIndices.length === 0
                          ? callback()
                          : callback(
                              `${
                                Messages["task.bulk_create_invalid"]
                              } Error in line ${invalidTaskIndices.join(", ")}`,
                            );
                      },
                    },
                  ],
                })(
                  <TextArea
                    className="input-monospace"
                    placeholder="dataSet, taskTypeId, experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances, minX, minY, minZ, width, height, depth, project[, scriptId, baseAnnotationId]"
                    autoSize={{ minRows: 6 }}
                    style={{
                      fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
                    }}
                  />,
                )}
              </FormItem>
              <Divider>Alternatively Upload a CSV File</Divider>
              <FormItem hasFeedback>
                {getFieldDecorator("csvFile", {
                  valuePropName: "fileList",
                  getValueFromEvent: this.normFile,
                })(
                  <Upload.Dragger
                    accept=".csv,.txt"
                    name="csvFile"
                    beforeUpload={file => {
                      this.props.form.setFieldsValue({ csvFile: [file] });
                      return false;
                    }}
                  >
                    <p className="ant-upload-drag-icon">
                      <Icon type="inbox" />
                    </p>
                    <p className="ant-upload-text">Click or Drag File to This Area to Upload</p>
                    <p>
                      Upload a CSV file with your task specification in the same format as mentioned
                      above.
                    </p>
                  </Upload.Dragger>,
                )}
              </FormItem>
              <FormItem>
                {this.state.isUploading ? (
                  <Progress
                    percent={parseInt((this.state.tasksProcessed / this.state.tasksCount) * 100)}
                    showInfo
                    status="active"
                  />
                ) : null}

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

export default Form.create()(TaskCreateBulkView);
