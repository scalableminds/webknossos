import { Form, Row, Dropdown, Col, Button, Input, Select } from "antd";
import { DownloadOutlined, DownOutlined, RetweetOutlined } from "@ant-design/icons";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import React, { useEffect, useState } from "react";
import _ from "lodash";
import type { APIUser, APIProject, APITaskType } from "types/api_flow_types";
import { getEditableUsers, getProjects, getTaskTypes } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
const FormItem = Form.Item;

export type QueryObject = {
  taskType?: string;
  ids?: Array<string>;
  project?: string;
  user?: string;
  random?: boolean;
};
export type TaskFormFieldValues = {
  taskId?: string;
  taskTypeId?: string;
  projectId?: string;
  userId?: string;
  random?: boolean;
};
type Props = {
  onChange: (arg0: QueryObject) => Promise<void>;
  initialFieldValues: TaskFormFieldValues | null | undefined;
  isLoading: boolean;
  onDownloadAllTasks: (arg0: QueryObject) => Promise<void>;
};
type State = {
  users: Array<APIUser>;
  projects: Array<APIProject>;
  taskTypes: Array<APITaskType>;
  fieldValues: TaskFormFieldValues;
  isFetchingData: boolean;
};
const persistence = new Persistence<Pick<State, "fieldValues">>(
  {
    fieldValues: PropTypes.shape({
      taskId: PropTypes.string,
      taskTypeId: PropTypes.string,
      projectId: PropTypes.string,
      userId: PropTypes.string,
    }),
  },
  "taskSearch",
);

function TaskSearchForm({ onChange, initialFieldValues, isLoading, onDownloadAllTasks }: Props) {
  const [form] = Form.useForm<TaskFormFieldValues>();
  const [users, setUsers] = useState<APIUser[]>([]);
  const [projects, setProjects] = useState<APIProject[]>([]);
  const [taskTypes, setTaskTypes] = useState<APITaskType[]>([]);
  const [fieldValues, setFieldValues] = useState<TaskFormFieldValues>({});
  const [isFetchingData, setIsFetchingData] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    // initialize form with default values when navigating from
    // project / taskType list views or when restoring values from persisted state
    const { fieldValues: persistedfieldValues } = persistence.load();
    const persistedFieldValues = persistedfieldValues != null ? persistedfieldValues : {};
    const fieldValues = initialFieldValues != null ? initialFieldValues : persistedFieldValues;

    if (_.size(fieldValues) > 0) {
      form.setFieldsValue(fieldValues);
      handleSearchFormFinish(false);
    }
  }, [initialFieldValues]);

  useEffect(() => {
    persistence.persist({ fieldValues: fieldValues });
  }, [fieldValues]);

  async function fetchData() {
    setIsFetchingData(true);
    const [users, projects, taskTypes] = await Promise.all([
      getEditableUsers(),
      getProjects(),
      getTaskTypes(),
    ]);
    setUsers(users);
    setProjects(projects);
    setTaskTypes(taskTypes);
    setIsFetchingData(false);
  }

  function handleFormFinish(
    isRandom: boolean,
    onFinishCallback: (arg0: QueryObject) => Promise<void>,
    formValues: TaskFormFieldValues,
  ) {
    const queryObject: QueryObject = {
      ids: formValues.taskId
        ?.trim()
        .replace(/,?\s+,?/g, ",") // replace remaining whitespaces with commata
        .split(",")
        .filter((taskId: string) => taskId.length > 0),
      taskType: formValues.taskTypeId,
      user: formValues.userId,
      project: formValues.projectId,
      random: isRandom,
    };

    setFieldValues(formValues);
    onFinishCallback(queryObject);
  }

  function handleSearchFormFinish(isRandom: boolean, formValues?: TaskFormFieldValues) {
    if (formValues) {
      handleFormFinish(isRandom, onChange, formValues);
    }

    form.validateFields().then((validFormValues) => {
      handleFormFinish(isRandom, onChange, validFormValues);
    });
  }

  function handleDownloadAllTasks() {
    form
      .validateFields()
      .then((formValues) => handleFormFinish(false, onDownloadAllTasks, formValues));
  }

  function handleReset() {
    form.resetFields();
    setFieldValues({});
    onChange({});
  }

  const formItemLayout = {
    labelCol: {
      span: 5,
    },
    wrapperCol: {
      span: 19,
    },
  };
  return (
    <Form onFinish={(formValues) => handleSearchFormFinish(false, formValues)} form={form}>
      <Row gutter={40}>
        <Col span={12}>
          <FormItem name="taskId" {...formItemLayout} label="Task Id">
            <Input placeholder="One or More Task IDs" />
          </FormItem>
        </Col>
        <Col span={12}>
          <FormItem name="taskTypeId" {...formItemLayout} label="Task Type">
            <Select
              showSearch
              allowClear
              placeholder="Select a Task Type"
              optionFilterProp="label"
              style={{
                width: "100%",
              }}
              loading={isFetchingData}
              options={taskTypes.map((taskType: APITaskType) => ({
                value: taskType.id,
                label: `${taskType.summary}`,
              }))}
            />
          </FormItem>
        </Col>
      </Row>
      <Row gutter={40}>
        <Col span={12}>
          <FormItem name="projectId" {...formItemLayout} label="Project">
            <Select
              allowClear
              showSearch
              placeholder="Select a Project"
              optionFilterProp="label"
              style={{
                width: "100%",
              }}
              loading={isFetchingData}
              options={projects.map((project: APIProject) => ({
                value: project.id,
                label: `${project.name}`,
              }))}
            />
          </FormItem>
        </Col>
        <Col span={12}>
          <FormItem name="userId" {...formItemLayout} label="User">
            <Select
              allowClear
              showSearch
              placeholder="Select a User"
              optionFilterProp="label"
              style={{
                width: "100%",
              }}
              loading={isFetchingData}
              options={users
                .filter((u) => u.isActive)
                .map((user: APIUser) => ({
                  value: user.id,
                  label: `${user.lastName}, ${user.firstName} (${user.email})`,
                }))}
            />
          </FormItem>
        </Col>
      </Row>
      <Row>
        <Col
          span={24}
          style={{
            textAlign: "right",
          }}
        >
          <Dropdown
            menu={{
              onClick: () => handleSearchFormFinish(true),
              items: [
                {
                  key: "1",
                  icon: <RetweetOutlined />,
                  label: "Show random subset",
                },
              ],
            }}
          >
            <Button
              type="primary"
              htmlType="submit"
              disabled={isLoading}
              loading={isLoading}
              style={{
                paddingRight: 3,
              }}
            >
              Search <DownOutlined />
            </Button>
          </Dropdown>
          <Button
            style={{
              marginLeft: 8,
            }}
            onClick={handleReset}
          >
            Clear
          </Button>
          <Button
            style={{
              marginLeft: 8,
            }}
            onClick={handleDownloadAllTasks}
            disabled={isLoading}
            loading={isLoading}
          >
            Download tasks as CSV
            <DownloadOutlined />
          </Button>
        </Col>
      </Row>
    </Form>
  );
}

export default TaskSearchForm;
