import { DownOutlined, DownloadOutlined, RetweetOutlined } from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { getEditableUsers, getProjects, getTaskTypes } from "admin/rest_api";
import { Button, Col, Dropdown, Form, Input, Row, Select } from "antd";
import Persistence from "libs/persistence";
import { useEffectOnlyOnce } from "libs/react_hooks";
import _ from "lodash";
import { useEffect, useState } from "react";
import type { APIProject, APITaskType, APIUser } from "types/api_types";
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

const persistence = new Persistence<{ fieldValues: TaskFormFieldValues }>(
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
  const [isFetchingData, setIsFetchingData] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffectOnlyOnce(() => {
    // initialize form with default values when navigating from
    // project / taskType list views or when restoring values from persisted state
    const { fieldValues: persistedfieldValues } = persistence.load();
    const persistedFieldValues = persistedfieldValues != null ? persistedfieldValues : {};
    const fieldValues = initialFieldValues != null ? initialFieldValues : persistedFieldValues;

    if (_.size(fieldValues) > 0) {
      form.setFieldsValue(fieldValues);
      handleSearchFormFinish(false);
    }
  });

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

  function onFormChange() {
    const formValues = form.getFieldsValue(true);
    persistence.persist({ fieldValues: formValues });
  }

  function handleFormFinish(
    isRandom: boolean,
    onFinishCallback: (arg0: QueryObject) => Promise<void>,
    formValues: TaskFormFieldValues,
  ) {
    const queryObject: QueryObject = {
      ids: formValues.taskId
        ?.trim()
        .replace(/,?\s+,?/g, ",") // replace remaining whitespaces with commas
        .split(",")
        .filter((taskId: string) => taskId.length > 0),
      taskType: formValues.taskTypeId,
      user: formValues.userId,
      project: formValues.projectId,
      random: isRandom,
    };

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
    <Form
      onFinish={(formValues) => handleSearchFormFinish(false, formValues)}
      form={form}
      onFieldsChange={onFormChange}
    >
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
