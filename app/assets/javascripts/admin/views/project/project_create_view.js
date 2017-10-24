import React from "react";
import { Form, Input, Select, Button, Card, InputNumber } from "antd";
import app from "app";
import { getUsers, getTeams, createProject } from "admin/admin_rest_api";
import type { APIUserType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;

type Props = {
  form: Object,
};

type State = {
  teams: Array<APITeamType>,
  users: Array<APIUserType>,
  isMTurkProject: boolean,
};

class ProjectCreateView extends React.PureComponent<Props, State> {
  state = {
    teams: [],
    users: [],
    isMTurkProject: false,
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async fetchData() {
    const users = await getUsers();
    const teams = await getTeams();

    this.setState({
      users: users.filter(user => user.isActive),
      teams,
    });
  }

  applyDefaults() {
    const defaultValues = {
      owner: app.currentUser.id,
      priority: 100,
      expectedTime: 90,
      assignmentConfiguration: {
        location: "webknossos",
      },
    };

    const defaultFormValues = Object.assign({}, defaultValues);
    this.props.form.setFieldsValue(defaultFormValues);
  }

  handleSubmit = e => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        await createProject(formValues);
        app.router.navigate("/projects", { trigger: true });
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const fullWidth = { width: "100%" };

    return (
      <div className="row container wide project-administration">
        <Card title={<h3>Create Project</h3>}>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="Project Name" hasFeedback>
              {getFieldDecorator("name", {
                rules: [
                  {
                    required: true,
                  },
                  { min: 3 },
                ],
              })(<Input autoFocus />)}
            </FormItem>

            <FormItem label="Team" hasFeedback>
              {getFieldDecorator("team", {
                rules: [
                  {
                    required: true,
                  },
                ],
              })(
                <Select
                  showSearch
                  placeholder="Select a Team"
                  optionFilterProp="children"
                  style={fullWidth}
                >
                  {this.state.teams.map((team: APITeamType) => (
                    <Option key={team.id} value={team.name}>
                      {team.name}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem label="Owner" hasFeedback>
              {getFieldDecorator("owner", {
                rules: [
                  {
                    required: true,
                  },
                ],
              })(
                <Select
                  showSearch
                  placeholder="Select a User"
                  optionFilterProp="children"
                  style={fullWidth}
                >
                  {this.state.users.map((user: APIUserType) => (
                    <Option key={user.id} value={user.id}>
                      {`${user.lastName}, ${user.firstName} ${user.email}`}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem label="Priority" hasFeedback>
              {getFieldDecorator("priority", {
                rules: [{ required: true }, { type: "number" }],
              })(<InputNumber style={fullWidth} />)}
            </FormItem>

            <FormItem label="Time Limit (Minutes)" hasFeedback>
              {getFieldDecorator("expectedTime", {
                rules: [{ required: true }, { type: "number", min: 1 }],
              })(<InputNumber style={fullWidth} />)}
            </FormItem>

            <FormItem label="Project Type" hasFeedback>
              {getFieldDecorator("assignmentConfiguration.location", {
                rules: [
                  {
                    required: true,
                  },
                ],
              })(
                <Select allowClear optionFilterProp="children" style={fullWidth}>
                  <Option value="webknossos">webKnossos</Option>
                  <Option value="mturk">Mechanical Turk</Option>
                </Select>,
              )}
            </FormItem>

            <FormItem>
              <Button type="primary" htmlType="submit">
                Create Project
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );
  }
}

export default Form.create()(ProjectCreateView);
