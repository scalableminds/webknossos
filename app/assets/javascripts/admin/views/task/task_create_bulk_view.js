// @flow
import _ from "lodash";
import React from "react";
import { Form, Input, Button, Card, Upload, Icon, Spin, Progress } from "antd";
import { createTasks } from "admin/admin_rest_api";
import { handleTaskCreationResponse } from "admin/views/task/task_create_form_view";
import Messages from "messages";
import Toast from "libs/toast";

import type { APITaskType } from "admin/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import type { BoundingBoxObjectType } from "oxalis/store";

const FormItem = Form.Item;
const TextArea = Input.TextArea;

const NUM_TASKS_PER_BATCH = 100;

type Props = {
  form: Object,
};

type State = {
  isUploading: boolean,
  tasksCount: number,
  tasksProcessed: number,
};

export type NewTaskType = {
  +boundingBox: BoundingBoxObjectType,
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
  +team: string,
  +taskTypeId: string,
  +csvFile?: File,
  +nmlFile?: File,
};

export type TaskCreationResponseType = {
  status: number,
  success?: APITaskType,
  error?: string,
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

  isValidTask(task: NewTaskType): boolean {
    if (
      !_.isString(task.neededExperience.domain) ||
      !_.isString(task.dataSet) ||
      !_.isString(task.taskTypeId) ||
      !_.isString(task.team) ||
      !_.isString(task.projectName) ||
      task.editPosition.some(isNaN) ||
      task.editRotation.some(isNaN) ||
      task.boundingBox.topLeft.some(isNaN) ||
      isNaN(task.openInstances) ||
      isNaN(task.neededExperience.value) ||
      isNaN(task.boundingBox.width) ||
      isNaN(task.boundingBox.height) ||
      isNaN(task.boundingBox.depth)
    ) {
      return false;
    }

    return true;
  }

  splitToLines(string: string): Array<string> {
    return string.trim().split("\n");
  }

  splitToWords(string: string): Array<string> {
    return string
      .split(",")
      .map(word => word.trim())
      .filter(word => word !== "");
  }

  parseText(bulkText: string): Array<NewTaskType> {
    return this.splitToLines(bulkText)
      .map(line => this.parseLine(line))
      .filter(task => task !== null);
  }

  parseLine(line: string): NewTaskType {
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
    const team = words[11];
    const minX = parseInt(words[12]);
    const minY = parseInt(words[13]);
    const minZ = parseInt(words[14]);
    const width = parseInt(words[15]);
    const height = parseInt(words[16]);
    const depth = parseInt(words[17]);
    const projectName = words[18];
    const scriptId = words[19] || undefined;

    return {
      dataSet,
      team,
      taskTypeId,
      scriptId,
      openInstances,
      neededExperience: {
        value: minExperience,
        domain: experienceDomain,
      },
      editPosition: [x, y, z],
      editRotation: [rotX, rotY, rotZ],
      boundingBox: {
        topLeft: [minX, minY, minZ],
        width,
        height,
        depth,
      },
      projectName,
      isForAnonymous: false,
    };
  }

  async readCSVFile(csvFile: File): Promise<Array<NewTaskType>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      // $FlowFixMe reader.result is wrongfully typed as ArrayBuffer
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

  getInvalidTaskIndices(tasks: Array<NewTaskType>): Array<number> {
    // returns the index / line number of an invalidly parsed task
    // returned indicies start at 1 for easier matching by non-CS people
    const isValidTasks = tasks.map(this.isValidTask);
    const invalidTasks = isValidTasks.reduce(
      (result: Array<number>, isValid: boolean, i: number) => {
        if (!isValid) {
          result.push(i + 1);
        }
        return result;
      },
      [],
    );
    return invalidTasks;
  }

  async batchUpload(tasks: Array<NewTaskType>) {
    // upload the tasks in batches to save the server from dying
    this.setState({
      isUploading: true,
      tasksCount: tasks.length,
      tasksProcessed: 0,
    });

    try {
      let responses = [];

      for (let i = 0; i < tasks.length; i += NUM_TASKS_PER_BATCH) {
        const subArray = tasks.slice(i, i + NUM_TASKS_PER_BATCH);
        // eslint-disable-next-line no-await-in-loop
        const response = await createTasks(subArray);
        responses = responses.concat(response);
        this.setState({
          tasksProcessed: i + NUM_TASKS_PER_BATCH,
        });
      }

      handleTaskCreationResponse(responses);
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
      <div className="container wide" style={{ paddingTop: 20 }}>
        <Spin spinning={this.state.isUploading}>
          <Card title={<h3>Bulk Create Tasks</h3>}>
            <p>
              Specify each new task on a separate line as comma seperated values (CSV) in the
              following format:
              <br />
              <a href="/dashboard">dataSet</a>, <a href="/taskTypes">taskTypeId</a>,
              experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances,{" "}
              <a href="/teams">team</a>, minX, minY, minZ, width, height, depth,
              <a href="/projects">project</a>[, <a href="/scripts">scriptId</a>]
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
                              `${Messages[
                                "task.bulk_create_invalid"
                              ]} Error in line ${invalidTaskIndices.join(", ")}`,
                            );
                      },
                    },
                  ],
                })(
                  <TextArea
                    className="input-monospace"
                    placeholder="dataSet, taskTypeId, experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances, team, minX, minY, minZ, width, height, depth, project[, scriptId]"
                    autosize={{ minRows: 6 }}
                  />,
                )}
              </FormItem>
              <hr />
              <FormItem label="Alternatively Upload a CSV File" hasFeedback>
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
                    percent={parseInt(this.state.tasksProcessed / this.state.tasksCount * 100)}
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
