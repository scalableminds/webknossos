// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import {
  Row,
  Col,
  Divider,
  Form,
  Select,
  Button,
  Card,
  Radio,
  Upload,
  Modal,
  InputNumber,
  Input,
  Spin,
} from "antd";
import { FormInstance } from "antd/lib/form";
import Toast from "libs/toast";
import React from "react";
import { InboxOutlined } from "@ant-design/icons";
import _ from "lodash";

import type { APIDataset, APITaskType, APIProject, APIScript, APITask } from "types/api_flow_types";
import type { BoundingBoxObject } from "oxalis/store";
import {
  type TaskCreationResponse,
  type TaskCreationResponseContainer,
  normFile,
} from "admin/task/task_create_bulk_view";
import { Vector3Input, Vector6Input } from "libs/vector_input";
import type { Vector6 } from "oxalis/constants";
import {
  createTaskFromNML,
  createTasks,
  getActiveDatasets,
  getAnnotationInformation,
  getProjects,
  getScripts,
  getTask,
  getTaskTypes,
  updateTask,
} from "admin/admin_rest_api";
import { tryToAwaitPromise } from "libs/utils";
import SelectExperienceDomain from "components/select_experience_domain";
import messages from "messages";
import Enum from "Enumjs";
import { saveAs } from "file-saver";
import { formatDateInLocalTimeZone } from "components/formatted_date";

const FormItem = Form.Item;
const RadioGroup = Radio.Group;

const fullWidth = { width: "100%" };
const maxDisplayedTasksCount = 50;

const TASK_CSV_HEADER =
  "taskId,dataSet,taskTypeId,experienceDomain,minExperience,x,y,z,rotX,rotY,rotZ,instances,minX,minY,minZ,width,height,depth,project,scriptId,creationInfo";

type Props = {
  taskId: ?string,
  history: RouterHistory,
};

export const SpecificationEnum = Enum.make({
  Manual: "Manual",
  Nml: "Nml",
  BaseAnnotation: "BaseAnnotation",
});
type Specification = $Keys<typeof SpecificationEnum>;

type State = {
  datasets: Array<APIDataset>,
  taskTypes: Array<APITaskType>,
  projects: Array<APIProject>,
  scripts: Array<APIScript>,
  specificationType: Specification,
  isUploading: boolean,
  isFetchingData: boolean,
};

export function taskToShortText(task: APITask) {
  const { id, creationInfo, editPosition } = task;
  return `${id},${creationInfo || "null"},(${editPosition.join(",")})`;
}

export function taskToText(task: APITask) {
  const {
    id,
    dataSet,
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
  const [editPositionAsString, editRotationAsString] = [editPosition, editRotation].map(vector3 =>
    vector3.join(","),
  );
  const totalNumberOfInstances = status.open + status.active + status.finished;
  const boundingBoxAsString = boundingBoxVec6 ? boundingBoxVec6.join(",") : "0,0,0,0,0,0";
  const scriptId = script ? `${script.id}` : "";
  const creationInfoOrEmpty = creationInfo || "";

  const taskAsString =
    `${id},${dataSet},${type.id},${neededExperienceAsString},${editPositionAsString},` +
    `${editRotationAsString},${totalNumberOfInstances},${boundingBoxAsString},${projectName},${scriptId},${creationInfoOrEmpty}`;
  return taskAsString;
}

export function downloadTasksAsCSV(tasks: Array<APITask>) {
  if (tasks.length < 0) {
    return;
  }
  const maybeTaskPlural = tasks.length > 2 ? "tasks" : "task";
  const lastCreationTime = Math.max(...tasks.map(task => task.created));
  const currentDateAsString = formatDateInLocalTimeZone(lastCreationTime);
  const allTeamNames = _.uniq(tasks.map(task => task.team));
  const teamName = allTeamNames.length > 1 ? "multiple_teams" : allTeamNames[0];
  const allTasksAsStrings = tasks.map(task => taskToText(task)).join("\n");
  const csv = [TASK_CSV_HEADER, allTasksAsStrings].join("\n");
  const filename = `${teamName}-${maybeTaskPlural}-${currentDateAsString}.csv`;
  const blob = new Blob([csv], { type: "text/plain;charset=utf-8" });
  saveAs(blob, filename);
}

export function handleTaskCreationResponse(response: TaskCreationResponseContainer) {
  const { tasks, warnings } = response;
  const successfulTasks = [];
  const failedTasks = [];
  let teamName = null;

  const subHeadingStyle = { fontWeight: "bold" };
  const displayResultsStyle = { maxHeight: 300, overflow: "auto" };

  const warningsContent =
    warnings.length > 0 ? (
      <div>
        <div style={subHeadingStyle}>There were warnings during task creation:</div>
        <div>{warnings.join("\n")}</div>
      </div>
    ) : null;

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
  const failedTasksAsString = failedTasks.join("");
  const successfulTasksContent =
    successfulTasks.length <= maxDisplayedTasksCount ? (
      <pre>
        taskId,filename,position
        <br />
        {successfulTasks.map(task => taskToShortText(task)).join("\n")}
      </pre>
    ) : (
      "Too many tasks to show, please use CSV download for a full list."
    );
  const failedTasksContent =
    failedTasks.length <= maxDisplayedTasksCount ? (
      <pre>{failedTasksAsString}</pre>
    ) : (
      "Too many failed tasks to show, please use CSV download for a full list."
    );
  const successPlural = successfulTasks.length === 1 ? "" : "s";
  const warningsPlural = warnings.length === 1 ? "" : "s";
  Modal.info({
    title: `${successfulTasks.length} task${successPlural} successfully created, ${
      failedTasks.length
    } failed. ${warnings.length} warning${warningsPlural}.`,
    content: (
      <div>
        {warningsContent}
        {successfulTasks.length > 0 ? (
          <div>
            <div style={subHeadingStyle}> Successful Tasks: </div>
            <div style={displayResultsStyle}>{successfulTasksContent}</div>
          </div>
        ) : null}
        {successfulTasks.length > 0 ? (
          <React.Fragment>
            <br />
            <Button onClick={() => downloadTasksAsCSV(successfulTasks)}>
              Download task info as CSV
            </Button>
            <br />
          </React.Fragment>
        ) : null}
        {failedTasks.length > 0 ? (
          <React.Fragment>
            <Divider />
            <div>
              <br />
              <div style={subHeadingStyle}> Failed Tasks:</div>
              <div style={displayResultsStyle}> {failedTasksContent}</div>
              <br />
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
              <br />
            </div>
          </React.Fragment>
        ) : null}
      </div>
    ),
    width: 600,
  });
}

class TaskCreateFormView extends React.PureComponent<Props, State> {
  formRef = React.createRef<typeof FormInstance>();
  state = {
    datasets: [],
    taskTypes: [],
    projects: [],
    scripts: [],
    specificationType: SpecificationEnum.Manual,
    isUploading: false,
    isFetchingData: false,
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async fetchData() {
    this.setState({ isFetchingData: true });
    const [datasets, projects, scripts, taskTypes] = await Promise.all([
      getActiveDatasets(),
      getProjects(),
      getScripts(),
      getTaskTypes(),
    ]);
    this.setState({ datasets, projects, scripts, taskTypes, isFetchingData: false });
  }

  async applyDefaults() {
    const form = this.formRef.current;
    if (!form) {
      Toast.info(messages["ui.no_form_active"]);
      return;
    }
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
      form.setFieldsValue(neededFormValues);
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

  onFinish = async formValues => {
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
        if (this.state.specificationType === SpecificationEnum.Nml) {
          // Workaround: Antd replaces file objects in the formValues with a wrapper file
          // The original file object is contained in the originFileObj property
          // This is most likely not intentional and may change in a future Antd version
          formValues.nmlFiles = formValues.nmlFiles.map(wrapperFile => wrapperFile.originFileObj);
          response = await createTaskFromNML(formValues);
        } else {
          if (this.state.specificationType !== SpecificationEnum.BaseAnnotation) {
            // Ensure that the base annotation field is null, if the specification mode
            // does not include that field.
            formValues.baseAnnotation = null;
          }
          response = await createTasks([formValues]);
        }
        handleTaskCreationResponse(response);
      } finally {
        this.setState({
          isUploading: false,
        });
      }
    }
  };

  renderSpecification() {
    const isEditingMode = this.props.taskId != null;

    if (this.state.specificationType === SpecificationEnum.Nml) {
      return (
        <FormItem
          name="nmlFiles"
          label="NML Files"
          hasFeedback
          rules={[{ required: true }]}
          valuePropName="fileList"
          getValueFromEvent={normFile}
        >
          <Upload.Dragger accept=".nml,.zip" name="nmlFiles" beforeUpload={() => false}>
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
    } else {
      return (
        <div>
          {this.state.specificationType === SpecificationEnum.BaseAnnotation ? (
            <FormItem
              name={["baseAnnotation", "baseId"]}
              label="Base ID"
              hasFeedback
              rules={[
                { required: true },
                {
                  validator: async (rule, value) => {
                    const newestForm = this.formRef.current;
                    if (!newestForm || value === "") {
                      return Promise.resolve();
                    }

                    const annotationResponse =
                      (await tryToAwaitPromise(
                        getAnnotationInformation(value, "Task", {
                          showErrorToast: false,
                        }),
                      )) ||
                      (await tryToAwaitPromise(
                        getAnnotationInformation(value, "Explorational", {
                          showErrorToast: false,
                        }),
                      ));

                    if (annotationResponse != null && annotationResponse.dataSetName != null) {
                      newestForm.setFieldsValue({
                        dataSet: annotationResponse.dataSetName,
                      });
                      return Promise.resolve();
                    }

                    const taskResponse = await tryToAwaitPromise(
                      getTask(value, { showErrorToast: false }),
                    );

                    if (
                      taskResponse != null &&
                      taskResponse.dataSet != null &&
                      _.isEqual(taskResponse.status, { open: 0, active: 0, finished: 1 })
                    ) {
                      newestForm.setFieldsValue({
                        dataSet: taskResponse.dataSet,
                      });
                      return Promise.resolve();
                    }

                    newestForm.setFieldsValue({ dataSet: null });
                    return Promise.reject(new Error("Invalid base annotation id."));
                  },
                },
              ]}
            >
              <Input style={fullWidth} disabled={isEditingMode} />
            </FormItem>
          ) : null}

          <FormItem name="dataSet" label="Dataset" hasFeedback rules={[{ required: true }]}>
            <Select
              showSearch
              placeholder={
                this.state.specificationType === SpecificationEnum.BaseAnnotation
                  ? "The dataset is inferred from the base annotation."
                  : "Select a Dataset"
              }
              optionFilterProp="label"
              style={fullWidth}
              disabled={
                isEditingMode || this.state.specificationType === SpecificationEnum.BaseAnnotation
              }
              notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
              options={this.state.datasets.map((dataset: APIDataset) => ({
                label: dataset.name,
                value: dataset.name,
              }))}
            />
          </FormItem>

          <FormItem
            name="editPosition"
            label="Starting Position"
            hasFeedback
            rules={[{ required: true }]}
          >
            <Vector3Input style={fullWidth} disabled={isEditingMode} />
          </FormItem>

          <FormItem
            name="editRotation"
            label="Starting Rotation"
            hasFeedback
            rules={[{ required: true }]}
          >
            <Vector3Input style={fullWidth} disabled={isEditingMode} />
          </FormItem>
        </div>
      );
    }
  }

  render() {
    const isEditingMode = this.props.taskId != null;
    const titleLabel = isEditingMode ? `Update Task ${this.props.taskId || ""}` : "Create Task";
    const instancesLabel = isEditingMode ? "Remaining Instances" : "Task Instances";

    return (
      <div className="container" style={{ paddingTop: 20 }}>
        <Spin spinning={this.state.isUploading}>
          <Card title={<h3>{titleLabel}</h3>}>
            <Form
              onFinish={this.onFinish}
              layout="vertical"
              ref={this.formRef}
              initialValues={{ editPosition: [0, 0, 0], editRotation: [0, 0, 0] }}
            >
              <FormItem name="taskTypeId" label="TaskType" hasFeedback rules={[{ required: true }]}>
                <Select
                  showSearch
                  placeholder="Select a TaskType"
                  optionFilterProp="label"
                  style={fullWidth}
                  disabled={isEditingMode}
                  notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                  options={this.state.taskTypes.map((taskType: APITaskType) => ({
                    value: taskType.id,
                    label: taskType.summary,
                  }))}
                />
              </FormItem>

              <Row gutter={8}>
                <Col span={12}>
                  <FormItem
                    name={["neededExperience", "domain"]}
                    label="Experience Domain"
                    hasFeedback
                    rules={[{ required: true }]}
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
                <Col span={12}>
                  <FormItem
                    name={["neededExperience", "value"]}
                    label="Experience Value"
                    hasFeedback
                    rules={[{ required: true }, { type: "number" }]}
                  >
                    <InputNumber style={fullWidth} disabled={isEditingMode} />
                  </FormItem>
                </Col>
              </Row>

              <FormItem
                name="openInstances"
                label={instancesLabel}
                hasFeedback
                rules={[{ required: true }, { type: "number" }]}
              >
                <InputNumber style={fullWidth} min={0} />
              </FormItem>

              <FormItem name="projectName" label="Project" hasFeedback rules={[{ required: true }]}>
                <Select
                  showSearch
                  placeholder="Select a Project"
                  optionFilterProp="label"
                  style={fullWidth}
                  disabled={isEditingMode}
                  notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                  options={this.state.projects.map((project: APIProject) => ({
                    value: project.name,
                    label: project.name,
                  }))}
                />
              </FormItem>

              <FormItem name="scriptId" label="Script" hasFeedback>
                <Select
                  showSearch
                  placeholder="Select a Script"
                  optionFilterProp="label"
                  style={fullWidth}
                  disabled={isEditingMode}
                  notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                  options={this.state.scripts.map((script: APIScript) => ({
                    value: script.id,
                    label: script.name,
                  }))}
                />
              </FormItem>

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
                  value={this.state.specificationType}
                  onChange={(evt: SyntheticInputEvent<*>) =>
                    this.setState({
                      // $FlowIssue[incompatible-call] Inference for enum.coalesce does not work properly anymore? Flow update might help
                      specificationType: Enum.coalesce(SpecificationEnum, evt.target.value),
                    })
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

              {this.renderSpecification()}

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

export default withRouter(TaskCreateFormView);
