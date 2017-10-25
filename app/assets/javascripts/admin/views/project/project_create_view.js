import React from "react";
import { Form, Input, Select, Button, Card, InputNumber } from "antd";
import app from "app";
import { getUsers, getTeams, createProject, getProject, updateProject } from "admin/admin_rest_api";
import type { APIUserType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;

type Props = {
  form: Object,
  projectName: ?string,
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

  async applyDefaults() {
    const project = this.props.projectName ? await getProject(this.props.projectName) : null;
    const defaultValues = {
      priority: 100,
      expectedTime: 90,
      assignmentConfiguration: {
        location: "webknossos",
      },
    };

    const defaultFormValues = Object.assign({}, defaultValues, project, {
      owner: project ? project.owner.id : app.currentUser.id,
    });
    this.props.form.setFieldsValue(defaultFormValues);
  }

  handleSubmit = e => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        if (this.props.projectName) {
          await updateProject(this.props.projectName, formValues);
        } else {
          await createProject(formValues);
        }
        app.router.navigate("/projects", { trigger: true });
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;
    const isEditMode = this.props.projectName != null;
    const titlePrefix = isEditMode ? "Update " : "Create";
    const fullWidth = { width: "100%" };

    return (
      <div className="row container wide project-administration">
        <Card title={<h3>{titlePrefix} Project</h3>}>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="Project Name" hasFeedback>
              {getFieldDecorator("name", {
                rules: [
                  {
                    required: true,
                  },
                  { min: 3 },
                ],
              })(<Input autoFocus disabled={isEditMode} />)}
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
                  disabled={isEditMode}
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
                  disabled={isEditMode}
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
                <Select
                  allowClear
                  optionFilterProp="children"
                  style={fullWidth}
                  disabled={isEditMode}
                >
                  <Option value="webknossos">webKnossos</Option>
                  <Option value="mturk">Mechanical Turk</Option>
                </Select>,
              )}
            </FormItem>

            <FormItem>
              <Button type="primary" htmlType="submit">
                {titlePrefix} Project
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );
  }
}

export default Form.create()(ProjectCreateView);
