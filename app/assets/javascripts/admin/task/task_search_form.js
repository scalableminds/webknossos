// @flow
import _ from "lodash";
import React from "react";
import { Form, Row, Col, Button, Input, Select } from "antd";
import { getEditableUsers, getProjects, getTaskTypes } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import { withRouter } from "react-router-dom";
import type { APIUserType, APIProjectType, APITaskTypeType } from "admin/api_flow_types";
import type { RouterHistory } from "react-router-dom";

const FormItem = Form.Item;
const Option = Select.Option;

export type QueryObjectType = {
  taskType?: string,
  ids?: Array<string>,
  project?: string,
  user?: string,
};

export type TaskFormFieldValuesType = {
  taskId?: string,
  taskTypeId?: string,
  projectName?: string,
  userId?: string,
};

type Props = {
  form: Object,
  onChange: Function,
  initialFieldValues?: TaskFormFieldValuesType,
  isLoading: boolean,
  history: RouterHistory,
};

type State = {
  users: Array<APIUserType>,
  projects: Array<APIProjectType>,
  taskTypes: Array<APITaskTypeType>,
  fieldValues: TaskFormFieldValuesType,
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
  state = {
    users: [],
    projects: [],
    taskTypes: [],
    fieldValues: {},
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
      this.props.form.setFieldsValue(fieldValues);
      this.handleFormSubmit();
    }
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  async fetchData() {
    const [users, projects, taskTypes] = await Promise.all([
      getEditableUsers(),
      getProjects(),
      getTaskTypes(),
    ]);
    this.setState({ users, projects, taskTypes });
  }

  handleFormSubmit = (event: ?SyntheticInputEvent<*>) => {
    if (event) {
      event.preventDefault();
    }

    this.props.form.validateFields((err, formValues: TaskFormFieldValuesType) => {
      const queryObject: QueryObjectType = {};

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

      this.setState({ fieldValues: formValues });
      this.props.onChange(queryObject);
    });
  };

  handleReset = () => {
    this.props.form.resetFields();
    this.setState({ fieldValues: {} });
    this.props.onChange({});
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    return (
      <Form onSubmit={this.handleFormSubmit}>
        <Row gutter={40}>
          <Col span={12}>
            <FormItem {...formItemLayout} label="Task Id">
              {getFieldDecorator("taskId")(<Input placeholder="One or More Task IDs" />)}
            </FormItem>
          </Col>
          <Col span={12}>
            <FormItem {...formItemLayout} label="Task Type">
              {getFieldDecorator("taskTypeId")(
                <Select
                  showSearch
                  allowClear
                  placeholder="Select a Task Type"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                >
                  {this.state.taskTypes.map((taskType: APITaskTypeType) => (
                    <Option key={taskType.id} value={taskType.id}>
                      {`${taskType.summary}`}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>
          </Col>
        </Row>
        <Row gutter={40}>
          <Col span={12}>
            <FormItem {...formItemLayout} label="Project">
              {getFieldDecorator("projectName")(
                <Select
                  allowClear
                  showSearch
                  placeholder="Select a Project"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                >
                  {this.state.projects.map((project: APIProjectType) => (
                    <Option key={project.id} value={project.name}>
                      {`${project.name}`}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>
          </Col>
          <Col span={12}>
            <FormItem {...formItemLayout} label="User">
              {getFieldDecorator("userId")(
                <Select
                  allowClear
                  showSearch
                  placeholder="Select a User"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                >
                  {this.state.users.filter(u => u.isActive).map((user: APIUserType) => (
                    <Option key={user.id} value={user.id}>
                      {`${user.lastName}, ${user.firstName} ${user.email}`}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>
          </Col>
        </Row>
        <Row>
          <Col span={24} style={{ textAlign: "right" }}>
            <Button
              type="primary"
              htmlType="submit"
              disabled={this.props.isLoading}
              loading={this.props.isLoading}
            >
              Search
            </Button>
            <Button style={{ marginLeft: 8 }} onClick={this.handleReset}>
              Clear
            </Button>
          </Col>
        </Row>
      </Form>
    );
  }
}

export default withRouter(Form.create()(TaskSearchForm));
