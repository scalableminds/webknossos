import { InboxOutlined } from "@ant-design/icons";
import { createTasks } from "admin/api/tasks";
import { handleTaskCreationResponse } from "admin/task/task_create_form_view";
import { App, Button, Card, Divider, Form, Input, Progress, Spin, Upload } from "antd";
import Toast from "libs/toast";
import _ from "lodash";
import Messages from "messages";
import type { Vector3 } from "oxalis/constants";
import type { BoundingBoxObject } from "oxalis/store";
import { useState } from "react";
import type { APITask } from "types/api_flow_types";

const FormItem = Form.Item;
const { TextArea } = Input;

export const NUM_TASKS_PER_BATCH = 100;
export type NewTask = {
  readonly boundingBox: BoundingBoxObject | null | undefined;
  readonly datasetId: string;
  readonly editPosition: Vector3;
  readonly editRotation: Vector3;
  readonly neededExperience: {
    readonly domain: string;
    readonly value: number;
  };
  readonly projectName: string;
  readonly scriptId: string | null | undefined;
  readonly pendingInstances: number;
  readonly taskTypeId: string;
  readonly csvFile?: File;
  readonly nmlFiles?: File[];
  readonly baseAnnotation?:
    | {
        baseId: string;
      }
    | null
    | undefined;
};

export type NewNmlTask = Pick<
  NewTask,
  | "taskTypeId"
  | "neededExperience"
  | "pendingInstances"
  | "projectName"
  | "scriptId"
  | "boundingBox"
>;

export type TaskCreationResponse = {
  status: number;
  success?: APITask;
  error?: string;
};

export type TaskCreationResponseContainer = {
  tasks: TaskCreationResponse[];
  warnings: string[];
};

export function normalizeFileEvent(
  event:
    | File[]
    | {
        fileList: File[];
      },
) {
  if (Array.isArray(event)) {
    return event;
  }

  return event?.fileList;
}

function TaskCreateBulkView() {
  const { modal } = App.useApp();

  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [tasksCount, setTasksCount] = useState<number>(0);
  const [tasksProcessed, setTasksProcessed] = useState<number>(0);
  const [form] = Form.useForm();

  function isValidTask(task: NewTask): boolean {
    const { boundingBox } = task;

    if (
      !_.isString(task.neededExperience.domain) ||
      !_.isString(task.taskTypeId) ||
      !_.isString(task.projectName) ||
      task.editPosition.some(Number.isNaN) ||
      task.editRotation.some(Number.isNaN) ||
      Number.isNaN(task.pendingInstances) ||
      Number.isNaN(task.neededExperience.value) || // Bounding Box is optional and can be null
      (boundingBox != null
        ? boundingBox.topLeft.some(Number.isNaN) ||
          Number.isNaN(boundingBox.width) ||
          Number.isNaN(boundingBox.height) ||
          Number.isNaN(boundingBox.depth) || // is editPosition within the BoundingBox?
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

  function splitToLines(string: string): Array<string> {
    return string.trim().split("\n");
  }

  function splitToWords(string: string): Array<string> {
    return string.split(",").map((word) => word.trim());
  }

  function parseText(bulkText: string): Array<NewTask> {
    return splitToLines(bulkText)
      .map((line) => parseLine(line))
      .filter((task) => task !== null);
  }

  function parseLine(line: string): NewTask {
    const words = splitToWords(line);
    const datasetId = words[0];
    const taskTypeId = words[1];
    const experienceDomain = words[2];
    const minExperience = Number.parseInt(words[3]);
    const x = Number.parseInt(words[4]);
    const y = Number.parseInt(words[5]);
    const z = Number.parseInt(words[6]);
    const rotX = Number.parseInt(words[7]);
    const rotY = Number.parseInt(words[8]);
    const rotZ = Number.parseInt(words[9]);
    const pendingInstances = Number.parseInt(words[10]);
    const boundingBoxX = Number.parseInt(words[11]);
    const boundingBoxY = Number.parseInt(words[12]);
    const boundingBoxZ = Number.parseInt(words[13]);
    const width = Number.parseInt(words[14]);
    const height = Number.parseInt(words[15]);
    const depth = Number.parseInt(words[16]);
    const projectName = words[17];

    // mapOptional takes care of treating empty strings as null
    function mapOptional<U>(word: string, fn: (arg0: string) => U): U | null | undefined {
      return word != null && word !== "" ? fn(word) : undefined;
    }

    const scriptId = mapOptional(words[18], (a) => a);
    const baseAnnotation = mapOptional(words[19], (word) => ({
      baseId: word,
    }));
    // BoundingBox is optional and can be set to null by using the format [0, 0, 0, 0, 0, 0]
    const boundingBox =
      width <= 0 || height <= 0 || depth <= 0
        ? null
        : {
            topLeft: [boundingBoxX, boundingBoxY, boundingBoxZ] as Vector3,
            width,
            height,
            depth,
          };
    return {
      datasetId,
      taskTypeId,
      scriptId,
      pendingInstances,
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

  async function readCSVFile(csvFile: File): Promise<NewTask[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      // @ts-ignore reader.result is wrongfully typed as ArrayBuffer
      reader.onload = () => resolve(parseText(reader.result));

      reader.onerror = reject;
      reader.readAsText(csvFile);
    });
  }

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'formValues' implicitly has an 'any' typ... Remove this comment to see the full error message
  const handleSubmit = async (formValues) => {
    let tasks;

    if (formValues.csvFile?.length) {
      // Workaround: Antd replaces file objects in the formValues with a wrapper file
      // The original file object is contained in the originFileObj property
      // This is most likely not intentional and may change in a future Antd version
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'wrapperFile' implicitly has an 'any' ty... Remove this comment to see the full error message
      formValues.csvFile = formValues.csvFile.map((wrapperFile) => wrapperFile.originFileObj);
      tasks = await readCSVFile(formValues.csvFile[0]);
    } else {
      tasks = parseText(formValues.bulkText);
    }

    if (tasks.every(isValidTask)) {
      batchUpload(tasks);
    } else {
      const invalidTaskIndices = getInvalidTaskIndices(tasks);
      Toast.error(
        `${Messages["task.bulk_create_invalid"]} Error in line ${invalidTaskIndices.join(", ")}`,
      );
    }
  };

  function getInvalidTaskIndices(tasks: NewTask[]): number[] {
    // returns the index / line number of an invalidly parsed task
    // returned indices start at 1 for easier matching by non-CS people
    const isValidTasks = tasks.map(isValidTask);
    const invalidTasks: number[] = [];
    return isValidTasks.reduce((result, isValid: boolean, i: number) => {
      if (!isValid) {
        result.push(i + 1);
      }

      return result;
    }, invalidTasks);
  }

  async function batchUpload(tasks: NewTask[]) {
    // upload the tasks in batches to save the server from dying
    setIsUploading(true);
    setTasksCount(tasks.length);
    setTasksProcessed(0);

    try {
      let taskResponses: TaskCreationResponse[] = [];
      let warnings: string[] = [];

      for (let i = 0; i < tasks.length; i += NUM_TASKS_PER_BATCH) {
        const subArray = tasks.slice(i, i + NUM_TASKS_PER_BATCH);

        const response = await createTasks(subArray);
        taskResponses = taskResponses.concat(response.tasks);
        warnings = warnings.concat(response.warnings);
        setTasksProcessed(i + NUM_TASKS_PER_BATCH);
      }

      handleTaskCreationResponse(modal, {
        tasks: taskResponses,
        warnings: _.uniq(warnings),
      });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div
      className="container"
      style={{
        paddingTop: 20,
      }}
    >
      <Spin spinning={isUploading}>
        <Card title={<h3>Bulk Create Tasks</h3>}>
          <p>
            Specify each new task on a separate line as comma separated values (CSV) in the
            following format:
            <br />
            <a href="/dashboard">datasetId</a>, <a href="/taskTypes">taskTypeId</a>,
            experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances, minX, minY, minZ,
            width, height, depth, <a href="/projects">project</a>, <a href="/scripts">scriptId</a>{" "}
            (optional), baseAnnotationId (optional)
            <br />
            If you want to define some (but not all) of the optional values, please list all
            optional values and use an empty value for the ones you do not want to set (e.g.,
            someValue,,someOtherValue if you want to omit the second value). If you do not want to
            define a bounding box, you may use 0, 0, 0, 0, 0, 0 for the corresponding values.
          </p>
          <Form onFinish={handleSubmit} layout="vertical" form={form}>
            <FormItem
              name="bulkText"
              label="Bulk Task Specification"
              hasFeedback
              rules={[
                ({ getFieldValue }) => ({
                  validator: (_rule, value) => {
                    // If a csv file has been uploaded it takes precedence and this form item doesn't need to validate
                    const csvFile = getFieldValue("csvFile");

                    if (csvFile?.length) {
                      return Promise.resolve();
                    }

                    const tasks = parseText(value);
                    const invalidTaskIndices = getInvalidTaskIndices(tasks);
                    return _.isString(value) && invalidTaskIndices.length === 0
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error(
                            `${
                              Messages["task.bulk_create_invalid"]
                            } Error in line ${invalidTaskIndices.join(", ")}`,
                          ),
                        );
                  },
                }),
              ]}
            >
              <TextArea
                className="input-monospace"
                placeholder="dataset, datasetId, taskTypeId, experienceDomain, minExperience, x, y, z, rotX, rotY, rotZ, instances, minX, minY, minZ, width, height, depth, project[, scriptId, baseAnnotationId]"
                autoSize={{
                  minRows: 6,
                }}
                style={{
                  fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
                }}
              />
            </FormItem>
            <Divider>Alternatively Upload a CSV File</Divider>
            <FormItem
              hasFeedback
              name="csvFile"
              valuePropName="fileList"
              getValueFromEvent={normalizeFileEvent}
            >
              <Upload.Dragger
                accept=".csv,.txt"
                name="csvFile"
                beforeUpload={(file) => {
                  form.setFieldsValue({
                    csvFile: [file],
                  });
                  return false;
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">Click or Drag File to This Area to Upload</p>
                <p>
                  Upload a CSV file with your task specification in the same format as mentioned
                  above.
                </p>
              </Upload.Dragger>
            </FormItem>
            <FormItem>
              {isUploading ? (
                <Progress percent={(tasksProcessed / tasksCount) * 100} showInfo status="active" />
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

export default TaskCreateBulkView;
