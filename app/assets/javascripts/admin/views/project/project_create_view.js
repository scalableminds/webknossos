// @flow
import React from "react";
import { connect } from "react-redux";
import { Form, Input, Select, Button, Card, InputNumber } from "antd";
import { getUsers, getTeams, createProject, getProject, updateProject } from "admin/admin_rest_api";
import type { APIUserType, APITeamType } from "admin/api_flow_types";
import type { ReactRouterHistoryType } from "react_router";
import type { OxalisState } from "oxalis/store";

const FormItem = Form.Item;
const Option = Select.Option;
const TextArea = Input.TextArea;

type Props = {
  form: Object,
  projectName: ?string,
  history: ReactRouterHistoryType,
  activeUser: APIUserType,
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
      owner: project ? project.owner.id : this.props.activeUser.id,
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
        this.props.history.push("/projects");
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
                rules: [{ required: true }],
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
                rules: [{ required: true }],
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
                rules: [{ required: true }],
              })(
                <Select
                  allowClear
                  optionFilterProp="children"
                  style={fullWidth}
                  disabled={isEditMode}
                  onChange={(value: string) => this.setState({ isMTurkProject: value === "mturk" })}
                >
                  <Option value="webknossos">webKnossos</Option>
                  <Option value="mturk">Mechanical Turk</Option>
                </Select>,
              )}
            </FormItem>

            {this.state.isMTurkProject ? (
              <div>
                <FormItem label="Mechanical Turk: Required Qualification" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration.requiredQualification", {
                    rules: [{ required: true }],
                    initialValue: "mt-everyone",
                  })(
                    <Select allowClear style={fullWidth} disabled={isEditMode}>
                      <Option value="mt-everyone">None</Option>
                      <Option value="mt-expert">Expert</Option>
                      <Option value="mpi-branchpoint">MPI Branchpoint</Option>
                      <Option value="mt-max-10k-hits">
                        Worker with less than 10k approved HITs
                      </Option>
                      <Option value="mt-min-10k-hits">
                        Worker with more than 10k approved HITs
                      </Option>
                    </Select>,
                  )}
                </FormItem>

                <FormItem label="Mechanical Turk: Assignment Duration in Seconds" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration[assignmentDurationInSeconds]", {
                    rules: [{ required: true }],
                    initialValue: 3600,
                  })(<InputNumber style={fullWidth} disabled={isEditMode} />)}
                </FormItem>

                <FormItem label="Mechanical Turk: Reward in USD" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration.rewardInDollar", {
                    rules: [{ required: true }],
                    initialValue: 0.05,
                  })(<InputNumber style={fullWidth} disabled={isEditMode} step={0.01} />)}
                </FormItem>

                <FormItem label="Mechanical Turk: Auto Approval Delay in Seconds" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration.autoApprovalDelayInSeconds", {
                    rules: [{ required: true }],
                    initialValue: 60000.0,
                  })(<InputNumber style={fullWidth} disabled={isEditMode} />)}
                </FormItem>

                <FormItem label="Mechanical Turk: HIT Template" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration.template", {
                    rules: [{ required: true }],
                    initialValue: "default_template",
                  })(
                    <Select allowClear style={fullWidth} disabled={isEditMode}>
                      <Option value="default_template">Default flight template</Option>
                      <Option value="branchpoint_template">Branchpoint template</Option>
                    </Select>,
                  )}
                </FormItem>

                <FormItem label="Mechanical Turk: Title" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration.title", {
                    rules: [{ required: true }],
                  })(<Input disabled={isEditMode} />)}
                </FormItem>

                <FormItem label="Mechanical Turk: Keywords (Comma Separated)" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration.keywords", {
                    rules: [{ required: true }],
                  })(<Input disabled={isEditMode} />)}
                </FormItem>

                <FormItem label="Mechanical Turk: Description" hasFeedback>
                  {getFieldDecorator("assignmentConfiguration.description", {
                    rules: [{ required: true }],
                  })(<TextArea disabled={isEditMode} rows={3} />)}
                </FormItem>
              </div>
            ) : null}

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

const mapStateToProps = (state: OxalisState) => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(Form.create()(ProjectCreateView));
