// @flow
import _ from "lodash";
import React from "react";
import { Form, Input, Button, Card, Upload, Icon, Spin } from "antd";
import Messages from "messages";
import { createTasksFromBulk } from "admin/admin_rest_api";
import { handleTaskCreationResponse } from "admin/views/task/task_create_subviews/task_create_form_view";
import type { APITaskType } from "admin/api_flow_types";

const FormItem = Form.Item;
const TextArea = Input.TextArea;

type Props = {
  form: Object,
};

type State = {
  isUploading: boolean,
};

class TaskCreateBulkImportView extends React.PureComponent<Props, State> {
  state = {
    isUploading: false,
  };

  isValidData(bulkText): boolean {
    const tasks = this.parseText(bulkText);
    return _.every(tasks, this.isValidTask);
  }

  isValidTask(task: APITaskType): boolean {
    if (
      !_.isString(task.neededExperience.domain) ||
      !_.isString(task.dataSet) ||
      !_.isString(task.taskTypeId) ||
      !_.isString(task.team) ||
      _.some(task.editPosition, isNaN) ||
      _.some(task.editRotation, isNaN) ||
      _.some(task.boundingBox.topLeft, isNaN) ||
      isNaN(task.status.open) ||
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
      .map(_.trim)
      .filter(word => word !== "");
  }

  parseText(bulkText: string): Array<?APITaskType> {
    return this.splitToLines(bulkText).map(line => this.parseLine(line));
  }

  parseLine(line: string): ?APITaskType {
    const words = this.splitToWords(line);
    if (words.length < 19) {
      return null;
    }

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
    const instances = parseInt(words[10]);
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
      neededExperience: {
        value: minExperience,
        domain: experienceDomain,
      },
      status: {
        open: instances,
        inProgress: 0,
        completed: 0,
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

  readCSVFile(csvFile: File): Array<APITaskType> {}

  handleSubmit = e => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        let tasks;
        if (formValues.csvFile) {
          tasks = this.readCSVFile(formValues.csvFile);
        } else {
          tasks = this.parseText(formValues.bulkText);
        }
        const response = await createTasksFromBulk(tasks);
        if (response.error === false) {
          handleTaskCreationResponse(response.items);
        }
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <div className="container wide" style={{ paddingTop: 20 }}>
        <Spin spinning={this.state.isUploading}>
          <Card title={<h3>Bulk Create Tasks</h3>}>
            <p>
              Specify each new task on a separate line as comma seperated values (CSV) in the
              followng format:
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
                      validator: (rule, value, callback) =>
                        this.isValidData(value)
                          ? callback()
                          : callback(Messages["task.bulk_create_invalid"]),
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
                {getFieldDecorator("csvFile")(
                  <Upload.Dragger
                    accept=".csv,.txt"
                    name="nmlFile"
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
                      Upload a CSV files with your task specification in the same format as
                      mentioned above.
                    </p>
                  </Upload.Dragger>,
                )}
              </FormItem>
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

export default Form.create()(TaskCreateBulkImportView);
