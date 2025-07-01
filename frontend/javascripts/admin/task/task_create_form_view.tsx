import { InboxOutlined, ReloadOutlined, WarningOutlined } from "@ant-design/icons";
import { createTaskFromNML, createTasks, getTask, updateTask } from "admin/api/tasks";
import {
  getActiveDatasetsOfMyOrganization,
  getProjects,
  getScripts,
  getTaskTypes,
  getUnversionedAnnotationInformation,
} from "admin/rest_api";
import type {
  NewNmlTask,
  NewTask,
  TaskCreationResponse,
  TaskCreationResponseContainer,
} from "admin/task/task_create_bulk_view";
import { NUM_TASKS_PER_BATCH, normalizeFileEvent } from "admin/task/task_create_bulk_view";
import {
  App,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Radio,
  type RadioChangeEvent,
  Row,
  Select,
  Spin,
  Tooltip,
  Upload,
  type UploadFile,
} from "antd";
import type { useAppProps } from "antd/es/app/context";
import { AsyncButton } from "components/async_clickables";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import SelectExperienceDomain from "components/select_experience_domain";
import { saveAs } from "file-saver";
import { coalesce, tryToAwaitPromise } from "libs/utils";
import { Vector3Input, Vector6Input } from "libs/vector_input";
import _ from "lodash";
import messages from "messages";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { APIDataset, APIProject, APIScript, APITask, APITaskType } from "types/api_types";
import type { Vector3, Vector6 } from "viewer/constants";
import type { BoundingBoxObject } from "viewer/store";

const FormItem = Form.Item;
const RadioGroup = Radio.Group;

const fullWidth = {
  width: "100%",
};
const maxDisplayedTasksCount = 50;

const TASK_CSV_HEADER =
  "taskId,datasetName,datasetId,taskTypeId,experienceDomain,minExperience,x,y,z,rotX,rotY,rotZ,instances,minX,minY,minZ,width,height,depth,project,scriptId,creationInfo";

export enum SpecificationEnum {
  Manual = "Manual",
  Nml = "Nml",
  BaseAnnotation = "BaseAnnotation",
}
type Specification = keyof typeof SpecificationEnum;

export function taskToShortText(task: APITask) {
  const { id, creationInfo, editPosition } = task;
  return `${id},${creationInfo || "null"},(${editPosition.join(",")})`;
}

export function taskToText(task: APITask) {
  const {
    id,
    datasetName,
    datasetId,
    type,
    neededExperience,
    editPosition,
    editRotation,
    status,
    creationInfo,
    boundingBoxVec6,
    projectName,
    script,
  } = task;
  const neededExperienceAsString = `${neededExperience.domain},${neededExperience.value}`;
  const [editPositionAsString, editRotationAsString] = [editPosition, editRotation].map((vector3) =>
    vector3.join(","),
  );
  const totalNumberOfInstances = status.pending + status.active + status.finished;
  const boundingBoxAsString = boundingBoxVec6 ? boundingBoxVec6.join(",") : "0,0,0,0,0,0";
  const scriptId = script ? `${script.id}` : "";
  const creationInfoOrEmpty = creationInfo || "";
  const taskAsString =
    `${id},${datasetName},${datasetId},${type.id},${neededExperienceAsString},${editPositionAsString},` +
    `${editRotationAsString},${totalNumberOfInstances},${boundingBoxAsString},${projectName},${scriptId},${creationInfoOrEmpty}`;
  return taskAsString;
}

export function downloadTasksAsCSV(tasks: Array<APITask>) {
  if (tasks.length < 0) {
    return;
  }

  const maybeTaskPlural = tasks.length > 1 ? "task_ids" : "task_id";
  const lastCreationTime = Math.max(...tasks.map((task) => task.created));
  const currentDateAsString = formatDateInLocalTimeZone(lastCreationTime, "YYYY-MM-DD_HH-mm");

  const allProjectNames = _.uniq(tasks.map((task) => task.projectName)).join("_");

  const allTasksAsStrings = tasks.map((task) => taskToText(task)).join("\n");
  const csv = [TASK_CSV_HEADER, allTasksAsStrings].join("\n");
  const filename = `${maybeTaskPlural}_${allProjectNames}_${currentDateAsString}.csv`;
  const blob = new Blob([csv], {
    type: "text/plain;charset=utf-8",
  });
  saveAs(blob, filename);
}

export function handleTaskCreationResponse(
  modal: useAppProps["modal"],
  response: TaskCreationResponseContainer,
) {
  const { tasks, warnings } = response;

  const successfulTasks: APITask[] = [];
  const failedTasks: string[] = [];
  let teamName: string | null = null;
  const subHeadingStyle: React.CSSProperties = {
    fontWeight: "bold",
  };
  const displayResultsStyle: React.CSSProperties = {
    maxHeight: 300,
    overflow: "auto",
  };

  tasks.forEach((taskResponse: TaskCreationResponse, i: number) => {
    if (taskResponse.status === 200 && taskResponse.success) {
      if (!teamName) {
        teamName = taskResponse.success.team;
      }

      successfulTasks.push(taskResponse.success);
    } else if (taskResponse.error) {
      failedTasks.push(`Line ${i}: ${taskResponse.error} \n`);
    }
  });

  const allProjectNames = _.uniq(successfulTasks.map((task) => task.projectName));

  if (allProjectNames.length > 1) {
    warnings.push(
      `You created tasks for multiple projects at a time: ${allProjectNames.join(", ")}.`,
    );
  }

  const warningsContent =
    warnings.length > 0 ? (
      <div>
        <div style={subHeadingStyle}>
          <WarningOutlined
            style={{
              color: "var(--ant-color-warning)",
            }}
          />{" "}
          There were warnings during task creation:
        </div>
        <div
          style={{
            whiteSpace: "pre-line",
          }}
        >
          {warnings.join("\n")}
        </div>
      </div>
    ) : null;

  const failedTasksAsString = failedTasks.join("");
  const successfulTasksContent =
    successfulTasks.length <= maxDisplayedTasksCount ? (
      <pre>
        taskId,filename,position
        <br />
        {successfulTasks.map((task) => taskToShortText(task)).join("\n")}
      </pre>
    ) : (
      "Too many tasks to show, please use the CSV download above for a full list."
    );
  const failedTasksContent =
    failedTasks.length <= maxDisplayedTasksCount ? (
      <pre>{failedTasksAsString}</pre>
    ) : (
      "Too many failed tasks to show, please use the CSV download for a full list."
    );
  const successPlural = successfulTasks.length === 1 ? "" : "s";
  const warningsPlural = warnings.length === 1 ? "" : "s";
  modal.info({
    title: `${successfulTasks.length} task${successPlural} successfully created, ${failedTasks.length} failed. ${warnings.length} warning${warningsPlural}.`,
    content: (
      <div>
        {warningsContent}
        {successfulTasks.length > 0 ? (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                margin: 20,
              }}
            >
              <Button onClick={() => downloadTasksAsCSV(successfulTasks)} type="primary">
                Download task info as CSV
              </Button>
            </div>
            <div style={subHeadingStyle}> Successful Tasks: </div>
            <div style={displayResultsStyle}>{successfulTasksContent}</div>
          </div>
        ) : null}
        {failedTasks.length > 0 ? (
          <React.Fragment>
            <Divider />
            <div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  margin: 20,
                }}
              >
                <Button
                  onClick={() => {
                    const blob = new Blob([failedTasksAsString], {
                      type: "text/plain;charset=utf-8",
                    });
                    saveAs(blob, "failed-tasks.csv");
                  }}
                >
                  Download failed task info as CSV
                </Button>
              </div>
              <div style={subHeadingStyle}> Failed Tasks:</div>
              <div style={displayResultsStyle}> {failedTasksContent}</div>
              <br />
              <br />
            </div>
          </React.Fragment>
        ) : null}
      </div>
    ),
    width: 600,
  });
}

export function CreateResourceButton({ text, link }: { text: string; link: string }) {
  return (
    <Col span={4} style={{ marginTop: 11 }}>
      <Button block href={link} target="_blank" rel="noreferrer">
        <span
          style={{
            display: "block",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {text}
        </span>
      </Button>
    </Col>
  );
}

export function ReloadResourceButton({
  tooltip,
  onReload,
}: {
  tooltip: string;
  onReload: () => Promise<void>;
}) {
  return (
    <Col flex="40px">
      <Tooltip title={tooltip}>
        <AsyncButton style={{ marginTop: 7 }} icon={<ReloadOutlined />} onClick={onReload} />
      </Tooltip>
    </Col>
  );
}

type Props = {
  taskId: string | null | undefined;
};

type FormValues = {
  baseAnnotation: NewTask["baseAnnotation"];
  boundingBox: Vector6 | null;
  taskTypeId: string;
  scriptId: string | null;
  pendingInstances: number;
  editPosition: Vector3;
  editRotation: Vector3;
  nmlFiles: UploadFile[];
  datasetId: string;
  datasetName: string;
  projectName: string;
  neededExperience: NewTask["neededExperience"];
};

function TaskCreateFormView({ taskId }: Props) {
  const navigate = useNavigate();
  const { modal } = App.useApp();
  const [form] = Form.useForm<FormValues>();

  const [datasets, setDatasets] = useState<APIDataset[]>([]);
  const [taskTypes, setTaskTypes] = useState<APITaskType[]>([]);
  const [projects, setProjects] = useState<APIProject[]>([]);
  const [scripts, setScripts] = useState<APIScript[]>([]);
  const [specificationType, setSpecificationType] = useState<Specification>(
    SpecificationEnum.Manual,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);

  useEffect(() => {
    fetchData();
    applyDefaults();
  }, []);

  async function fetchData() {
    setIsFetchingData(true);
    const [datasets, projects, scripts, taskTypes] = await Promise.all([
      getActiveDatasetsOfMyOrganization(),
      getProjects(),
      getScripts(),
      getTaskTypes(),
    ]);
    setDatasets(datasets);
    setProjects(projects);
    setScripts(scripts);
    setTaskTypes(taskTypes);
    setIsFetchingData(false);
  }

  async function applyDefaults() {
    if (taskId) {
      const task = await getTask(taskId);
      const defaultValues = Object.assign({}, task, {
        taskTypeId: task.type.id,
        boundingBox: task.boundingBox ? task.boundingBoxVec6 : null,
        scriptId: task.script ? task.script.id : null,
        pendingInstances: task.status.pending,
      });

      const validFormValues = _.omitBy(defaultValues, _.isNil);

      // The task type is not needed for the form and leads to antd errors if it contains null values
      const { type, ...neededFormValues } = validFormValues;
      form.setFieldsValue(neededFormValues);
    }
  }

  function transformBoundingBox(boundingBox: Vector6): BoundingBoxObject {
    return {
      topLeft: [boundingBox[0] || 0, boundingBox[1] || 0, boundingBox[2] || 0],
      width: boundingBox[3] || 0,
      height: boundingBox[4] || 0,
      depth: boundingBox[5] || 0,
    };
  }

  async function onFinish(formValues: FormValues) {
    const boundingBox = formValues.boundingBox
      ? transformBoundingBox(formValues.boundingBox)
      : null;

    if (taskId != null) {
      // either update an existing task
      const newTask = {
        ..._.omit(formValues, "nmlFiles", "baseAnnotation"),
        boundingBox,
      };
      const confirmedTask = await updateTask(taskId, newTask);
      navigate(`/tasks/${confirmedTask.id}`);
    } else {
      setIsUploading(true);
      // or create a new one either from the form values or with an NML file
      let taskResponses: TaskCreationResponse[] = [];
      let warnings: string[] = [];

      try {
        if (specificationType === SpecificationEnum.Nml) {
          // Workaround: Antd replaces file objects in the formValues with a wrapper file
          // The original file object is contained in the originFileObj property
          // This is most likely not intentional and may change in a future Antd version
          const nmlFiles = formValues.nmlFiles.map(
            (wrapperFile) => wrapperFile.originFileObj as File,
          );
          for (let i = 0; i < nmlFiles.length; i += NUM_TASKS_PER_BATCH) {
            const batchOfNmls = nmlFiles.slice(i, i + NUM_TASKS_PER_BATCH);

            const newTask: NewNmlTask = {
              ..._.omit(formValues, "baseAnnotation"),
              boundingBox,
            };
            const response = await createTaskFromNML(newTask, batchOfNmls);

            taskResponses = taskResponses.concat(response.tasks);
            warnings = warnings.concat(response.warnings);
          }
        } else {
          // Ensure that the base annotation field is null, if the specification mode
          // does not include that field.
          const baseAnnotation =
            specificationType !== SpecificationEnum.BaseAnnotation
              ? null
              : formValues.baseAnnotation;

          const newTask = {
            ..._.omit(formValues, "nmlFiles", "baseAnnotation"),
            boundingBox,
            baseAnnotation,
          };
          const response = await createTasks([newTask]);

          taskResponses = taskResponses.concat(response.tasks);
          warnings = warnings.concat(response.warnings);
        }

        handleTaskCreationResponse(modal, {
          tasks: taskResponses,
          warnings: _.uniq(warnings),
        });
      } finally {
        setIsUploading(false);
      }
    }
  }

  function renderSpecification() {
    const isEditingMode = taskId != null;

    if (specificationType === SpecificationEnum.Nml) {
      return (
        <FormItem
          name="nmlFiles"
          label="NML Files"
          hasFeedback
          rules={[
            {
              required: true,
            },
          ]}
          valuePropName="fileList"
          getValueFromEvent={normalizeFileEvent}
        >
          <Upload.Dragger accept=".nml,.zip" name="nmlFiles" beforeUpload={() => false} multiple>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or Drag Files to This Area to Upload</p>
            <p>
              Every nml creates a new task. You can upload multiple NML files or zipped collections
              of nml files (.zip).
            </p>
          </Upload.Dragger>
        </FormItem>
      );
    }
    return (
      <div>
        {specificationType === SpecificationEnum.BaseAnnotation ? (
          <FormItem
            name={["baseAnnotation", "baseId"]}
            label="Base ID"
            hasFeedback
            rules={[
              {
                required: true,
              },
              {
                validator: async (_rule, value) => {
                  if (!form || value === "") {
                    return Promise.resolve();
                  }

                  const annotationResponse = await tryToAwaitPromise(
                    getUnversionedAnnotationInformation(value, {
                      showErrorToast: false,
                    }),
                  );

                  if (annotationResponse?.dataSetName != null) {
                    form.setFieldsValue({
                      datasetName: annotationResponse.dataSetName,
                      datasetId: annotationResponse.datasetId,
                    });
                    return Promise.resolve();
                  }

                  const taskResponse = await tryToAwaitPromise(
                    getTask(value, {
                      showErrorToast: false,
                    }),
                  );

                  if (
                    taskResponse?.datasetId != null &&
                    _.isEqual(taskResponse.status, {
                      pending: 0,
                      active: 0,
                      finished: 1,
                    })
                  ) {
                    form.setFieldsValue({
                      datasetName: taskResponse.datasetName,
                      datasetId: taskResponse.datasetId,
                    });
                    return Promise.resolve();
                  }

                  form.setFieldsValue({
                    datasetName: undefined,
                    datasetId: undefined,
                  });
                  return Promise.reject(new Error("Invalid base annotation id."));
                },
              },
            ]}
          >
            <Input style={fullWidth} disabled={isEditingMode} />
          </FormItem>
        ) : null}

        <Row gutter={8} align="middle" wrap={false}>
          <Col flex="auto">
            <FormItem
              name="datasetId"
              label="Dataset"
              hasFeedback
              rules={[
                {
                  required: true,
                },
              ]}
            >
              <Select
                showSearch
                placeholder={
                  specificationType === SpecificationEnum.BaseAnnotation
                    ? "The dataset is inferred from the base annotation."
                    : "Select a Dataset"
                }
                optionFilterProp="label"
                style={fullWidth}
                disabled={isEditingMode || specificationType === SpecificationEnum.BaseAnnotation}
                loading={isFetchingData}
                options={datasets.map((dataset: APIDataset) => ({
                  label: dataset.name,
                  value: dataset.id,
                }))}
              />
            </FormItem>
          </Col>
          <ReloadResourceButton
            tooltip="Reload to show new Datasets"
            onReload={async () => setDatasets(await getActiveDatasetsOfMyOrganization())}
          />
          <CreateResourceButton text="Upload Dataset" link="/datasets/upload" />
        </Row>

        <FormItem
          name="editPosition"
          label="Starting Position"
          hasFeedback
          rules={[
            {
              required: true,
            },
          ]}
        >
          <Vector3Input style={fullWidth} disabled={isEditingMode} />
        </FormItem>

        <FormItem
          name="editRotation"
          label="Starting Rotation"
          hasFeedback
          rules={[
            {
              required: true,
            },
          ]}
        >
          <Vector3Input style={fullWidth} disabled={isEditingMode} />
        </FormItem>
      </div>
    );
  }

  const isEditingMode = taskId != null;
  const titleLabel = isEditingMode ? `Update Task ${taskId || ""}` : "Create Task";
  const instancesLabel = isEditingMode ? "Remaining Instances" : "Task Instances";
  return (
    <div
      className="container"
      style={{
        paddingTop: 20,
      }}
    >
      <Spin spinning={isUploading}>
        <Card title={<h3>{titleLabel}</h3>}>
          <Form
            onFinish={onFinish}
            layout="vertical"
            form={form}
            initialValues={{
              editPosition: [0, 0, 0],
              editRotation: [0, 0, 0],
            }}
          >
            <Row gutter={8} align="middle" wrap={false}>
              <Col flex="auto">
                <FormItem
                  name="taskTypeId"
                  label="Task Type"
                  hasFeedback
                  rules={[
                    {
                      required: true,
                    },
                  ]}
                >
                  <Select
                    showSearch
                    placeholder="Select a Task Type"
                    optionFilterProp="label"
                    style={fullWidth}
                    disabled={isEditingMode}
                    loading={isFetchingData}
                    options={taskTypes.map((taskType: APITaskType) => ({
                      value: taskType.id,
                      label: taskType.summary,
                    }))}
                  />
                </FormItem>
              </Col>
              <ReloadResourceButton
                tooltip="Reload to show new Task Types"
                onReload={async () => setTaskTypes(await getTaskTypes())}
              />
              <CreateResourceButton text="Create new Task Type" link="/taskTypes/create" />
            </Row>

            <Row gutter={8} align="middle" wrap={false}>
              <Col span={10}>
                <FormItem
                  name={["neededExperience", "domain"]}
                  label="Experience Domain"
                  hasFeedback
                  rules={[
                    {
                      required: true,
                    },
                  ]}
                >
                  <SelectExperienceDomain
                    disabled={isEditingMode}
                    placeholder="Select an Experience Domain"
                    notFoundContent={messages["task.domain_does_not_exist"]}
                    width={100}
                    allowCreation
                  />
                </FormItem>
              </Col>
              <Col flex="auto">
                <FormItem
                  name={["neededExperience", "value"]}
                  label="Experience Value"
                  hasFeedback
                  rules={[
                    {
                      required: true,
                    },
                    {
                      type: "number",
                    },
                  ]}
                >
                  <InputNumber style={fullWidth} disabled={isEditingMode} />
                </FormItem>
              </Col>
              <CreateResourceButton text="Assign Experience" link="/users" />
            </Row>

            <FormItem
              name="pendingInstances"
              label={instancesLabel}
              hasFeedback
              rules={[
                {
                  required: true,
                },
                {
                  type: "number",
                },
              ]}
            >
              <InputNumber style={fullWidth} min={0} />
            </FormItem>

            <Row gutter={8} align="middle" wrap={false}>
              <Col flex="auto">
                <FormItem
                  name="projectName"
                  label="Project"
                  hasFeedback
                  rules={[
                    {
                      required: true,
                    },
                  ]}
                >
                  <Select
                    showSearch
                    placeholder="Select a Project"
                    optionFilterProp="label"
                    style={fullWidth}
                    disabled={isEditingMode}
                    loading={isFetchingData}
                    options={projects.map((project: APIProject) => ({
                      value: project.name,
                      label: project.name,
                    }))}
                  />
                </FormItem>
              </Col>
              <ReloadResourceButton
                tooltip="Reload to show new Projects"
                onReload={async () => setProjects(await getProjects())}
              />
              <CreateResourceButton text="Create new Project" link="/projects/create" />
            </Row>

            <Row gutter={8} align="middle" wrap={false}>
              <Col flex="auto">
                <FormItem name="scriptId" label="Script" hasFeedback>
                  <Select
                    showSearch
                    placeholder="Select a Script"
                    optionFilterProp="label"
                    style={fullWidth}
                    disabled={isEditingMode}
                    loading={isFetchingData}
                    options={scripts.map((script: APIScript) => ({
                      value: script.id,
                      label: script.name,
                    }))}
                  />
                </FormItem>
              </Col>
              <ReloadResourceButton
                tooltip="Reload to show new Scripts"
                onReload={async () => setScripts(await getScripts())}
              />
              <CreateResourceButton text="Create new Script" link="/scripts/create" />
            </Row>

            <FormItem
              name="boundingBox"
              label="Bounding Box"
              extra="topLeft.x, topLeft.y, topLeft.z, width, height, depth"
              hasFeedback
            >
              <Vector6Input disabled={isEditingMode} />
            </FormItem>

            <FormItem label="Task Specification" hasFeedback>
              <RadioGroup
                value={specificationType}
                onChange={(evt: RadioChangeEvent) =>
                  setSpecificationType(
                    coalesce(SpecificationEnum, evt.target.value) || specificationType,
                  )
                }
              >
                <Radio value={SpecificationEnum.Manual} disabled={isEditingMode}>
                  Manual Specification
                </Radio>
                <Radio value={SpecificationEnum.Nml} disabled={isEditingMode}>
                  Upload NML File
                </Radio>
                <Radio value={SpecificationEnum.BaseAnnotation} disabled={isEditingMode}>
                  Use Annotation ID as Base
                </Radio>
              </RadioGroup>
            </FormItem>

            {renderSpecification()}

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

export default TaskCreateFormView;
