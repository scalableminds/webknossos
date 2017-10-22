// @flow
import React from "react";
import { Form, Row, Col, Button, Input, Select } from "antd";
import { getUsers, getProjects, getTaskTypes } from "admin/admin_rest_api";
import type { APIUserType, APIProjectType, APITaskTypeType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;

type Props = {
  form: Object,
  onChange: Function,
  initialFieldValues?: Object,
};

type State = {
  users: Array<APIUserType>,
  projects: Array<APIProjectType>,
  taskTypes: Array<APITaskTypeType>,
};

export type QueryObjectType = {
  taskType?: string,
  ids?: Array<string>,
  project?: string,
  user?: string,
};

class TaskSearchForm extends React.Component<Props, State> {
  state = {
    users: [],
    projects: [],
    taskTypes: [],
  };

  componentDidMount() {
    this.fetchData();

    // initialize form with default values when navigation from
    // project / taskType list views
    if (this.props.initialFieldValues) {
      this.props.form.setFieldsValue(this.props.initialFieldValues);
      this.handleFormSubmit();
    }
  }

  async fetchData() {
    this.setState({
      users: await getUsers(),
      projects: await getProjects(),
      taskTypes: await getTaskTypes(),
    });
  }

  handleFormSubmit = (event: ?SyntheticInputEvent<*>) => {
    if (event) {
      event.preventDefault();
    }

    this.props.form.validateFields((err, formValues) => {
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

      this.props.onChange(queryObject);
    });
  };

  handleReset = () => {
    this.props.form.resetFields();
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
            <Button type="primary" htmlType="submit">
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

// const mapPropsToFields = props => {
//   debugger;
//   return props.initialFieldValues;
// };

export default Form.create()(TaskSearchForm);
