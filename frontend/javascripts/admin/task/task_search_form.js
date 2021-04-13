// @flow
import { Form, Row, Dropdown, Menu, Col, Button, Input, Select, Spin } from "antd";
import { FormInstance } from "antd/lib/form";
import { DownloadOutlined, DownOutlined, RetweetOutlined } from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import { type RouterHistory, withRouter } from "react-router-dom";
import React from "react";
import _ from "lodash";

import messages from "messages";
import Toast from "libs/toast";
import type { APIUser, APIProject, APITaskType } from "types/api_flow_types";
import { getEditableUsers, getProjects, getTaskTypes } from "admin/admin_rest_api";
import Persistence from "libs/persistence";

const FormItem = Form.Item;

export type QueryObject = {
  taskType?: string,
  ids?: Array<string>,
  project?: string,
  user?: string,
  random?: boolean,
};

export type TaskFormFieldValues = {
  taskId?: string,
  taskTypeId?: string,
  projectName?: string,
  userId?: string,
  random?: boolean,
};

type Props = {
  onChange: QueryObject => Promise<void>,
  initialFieldValues: ?TaskFormFieldValues,
  isLoading: boolean,
  history: RouterHistory,
  onDownloadAllTasks: QueryObject => Promise<void>,
};

type State = {
  users: Array<APIUser>,
  projects: Array<APIProject>,
  taskTypes: Array<APITaskType>,
  fieldValues: TaskFormFieldValues,
  isFetchingData: boolean,
};

const persistence: Persistence<State> = new Persistence(
  {
    fieldValues: PropTypes.shape({
      taskId: PropTypes.string,
      taskTypeId: PropTypes.string,
      projectName: PropTypes.string,
      userId: PropTypes.string,
    }),
  },
  "taskSearch",
);

class TaskSearchForm extends React.Component<Props, State> {
  formRef = React.createRef<typeof FormInstance>();
  state = {
    users: [],
    projects: [],
    taskTypes: [],
    fieldValues: {},
    isFetchingData: false,
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchData();

    // initialize form with default values when navigating from
    // project / taskType list views or when restoring values from persisted state
    const fieldValues =
      this.props.initialFieldValues != null
        ? this.props.initialFieldValues
        : this.state.fieldValues;
    if (_.size(fieldValues) > 0) {
      const form = this.formRef.current;
      if (!form) {
        Toast.info(messages["ui.no_form_active"]);
        return;
      }
      form.setFieldsValue(fieldValues);
      this.handleSearchFormFinish(false);
    }
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  async fetchData() {
    this.setState({ isFetchingData: true });
    const [users, projects, taskTypes] = await Promise.all([
      getEditableUsers(),
      getProjects(),
      getTaskTypes(),
    ]);
    this.setState({ users, projects, taskTypes, isFetchingData: false });
  }

  handleFormFinish = (
    isRandom: boolean,
    onFinishCallback: QueryObject => Promise<void>,
    formValues: Object,
  ) => {
    const queryObject: QueryObject = {};

    if (formValues.taskId) {
      const taskIds = formValues.taskId
        .trim()
        .replace(/,?\s+,?/g, ",") // replace remaining whitespaces with commata
        .split(",")
        .filter((taskId: string) => taskId.length > 0);

      queryObject.ids = taskIds;
    }

    if (formValues.taskTypeId) {
      queryObject.taskType = formValues.taskTypeId;
    }

    if (formValues.userId) {
      queryObject.user = formValues.userId;
    }

    if (formValues.projectName) {
      queryObject.project = formValues.projectName;
    }

    if (isRandom) {
      queryObject.random = isRandom;
    }

    this.setState({ fieldValues: formValues });
    onFinishCallback(queryObject);
  };

  handleSearchFormFinish = (isRandom: boolean, formValues?: Object) => {
    if (formValues) {
      this.handleFormFinish(isRandom, this.props.onChange, formValues);
    }

    const form = this.formRef.current;
    if (!form) {
      Toast.info(messages["ui.no_form_active"]);
      return;
    }
    form.validateFields().then(validFormValues => {
      this.handleFormFinish(isRandom, this.props.onChange, validFormValues);
    });
  };

  handleDownloadAllTasks = () => {
    const form = this.formRef.current;
    if (!form) {
      Toast.info(messages["ui.no_form_active"]);
      return;
    }
    form
      .validateFields()
      .then(formValues => this.handleFormFinish(false, this.props.onDownloadAllTasks, formValues));
  };

  handleReset = () => {
    const form = this.formRef.current;
    if (!form) {
      return;
    }
    form.resetFields();
    this.setState({ fieldValues: {} });
    this.props.onChange({});
  };

  render() {
    const { isLoading } = this.props;
    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    return (
      <Form
        onFinish={formValues => this.handleSearchFormFinish(false, formValues)}
        ref={this.formRef}
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
                style={{ width: "100%" }}
                notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                options={this.state.taskTypes.map((taskType: APITaskType) => ({
                  value: taskType.id,
                  label: `${taskType.summary}`,
                }))}
              />
            </FormItem>
          </Col>
        </Row>
        <Row gutter={40}>
          <Col span={12}>
            <FormItem name="projectName" {...formItemLayout} label="Project">
              <Select
                allowClear
                showSearch
                placeholder="Select a Project"
                optionFilterProp="label"
                style={{ width: "100%" }}
                notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                options={this.state.projects.map((project: APIProject) => ({
                  value: project.name,
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
                style={{ width: "100%" }}
                notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                options={this.state.users
                  .filter(u => u.isActive)
                  .map((user: APIUser) => ({
                    value: user.id,
                    label: `${user.lastName}, ${user.firstName} (${user.email})`,
                  }))}
              />
            </FormItem>
          </Col>
        </Row>
        <Row>
          <Col span={24} style={{ textAlign: "right" }}>
            <Dropdown
              overlay={
                <Menu onClick={() => this.handleSearchFormFinish(true)}>
                  <Menu.Item key="1">
                    <RetweetOutlined />
                    Show random subset
                  </Menu.Item>
                </Menu>
              }
            >
              <Button
                type="primary"
                htmlType="submit"
                disabled={isLoading}
                loading={isLoading}
                style={{ paddingRight: 3 }}
              >
                Search <DownOutlined />
              </Button>
            </Dropdown>
            <Button style={{ marginLeft: 8 }} onClick={this.handleReset}>
              Clear
            </Button>
            <Button
              style={{ marginLeft: 8 }}
              onClick={this.handleDownloadAllTasks}
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
}

export default withRouter(TaskSearchForm);
