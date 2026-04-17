import { DownloadOutlined, DownOutlined, RetweetOutlined } from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { getEditableUsers, getProjects, getTaskTypes } from "admin/rest_api";
import { Button, Col, Dropdown, Flex, Form, Grid, Input, Row, Select, theme } from "antd";
import Persistence from "libs/persistence";
import { useEffectOnlyOnce } from "libs/react_hooks";
import size from "lodash-es/size";
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
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isCompact = !screens.lg;
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

    if (size(fieldValues) > 0) {
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
      flex: "80px",
    },
    wrapperCol: {
      flex: "1 1 220px",
    },
  };

  return (
    <div
      style={{
        maxWidth: 1120,
      }}
    >
      <Form
        onFinish={(formValues) => handleSearchFormFinish(false, formValues)}
        form={form}
        onFieldsChange={onFormChange}
        layout="horizontal"
        labelAlign="left"
        labelWrap
      >
        <Flex align="flex-start" gap={token.paddingLG} wrap={isCompact} style={{ width: "100%" }}>
          <div
            style={{
              flex: "1 1 720px",
              minWidth: 0,
            }}
          >
            <Row gutter={[token.paddingMD, 0]}>
              <Col xs={24} md={12}>
                <FormItem {...formItemLayout} name="taskId" label="Task ID">
                  <Input placeholder="One or more task IDs" />
                </FormItem>
              </Col>
              <Col xs={24} md={12}>
                <FormItem {...formItemLayout} name="taskTypeId" label="Task Type">
                  <Select
                    showSearch={{ optionFilterProp: "label" }}
                    allowClear
                    placeholder="Select a task type"
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
              <Col xs={24} md={12}>
                <FormItem {...formItemLayout} name="projectId" label="Project">
                  <Select
                    allowClear
                    showSearch={{ optionFilterProp: "label" }}
                    placeholder="Select a project"
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
              <Col xs={24} md={12}>
                <FormItem {...formItemLayout} name="userId" label="User">
                  <Select
                    allowClear
                    showSearch={{ optionFilterProp: "label" }}
                    placeholder="Select a user"
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
          </div>

          <Flex
            gap="small"
            wrap={isCompact}
            style={{
              width: isCompact ? "100%" : 220,
              marginLeft: isCompact ? 0 : "auto",
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
                icon={<DownOutlined />}
                iconPlacement="end"
                block={!isCompact}
              >
                Search
              </Button>
            </Dropdown>

            <Button onClick={handleReset} block={!isCompact}>
              Clear
            </Button>
            <Button
              onClick={handleDownloadAllTasks}
              disabled={isLoading}
              loading={isLoading}
              icon={<DownloadOutlined />}
              block={!isCompact}
            >
              Download tasks as CSV
            </Button>
          </Flex>
        </Flex>
      </Form>
    </div>
  );
}

export default TaskSearchForm;
