// @flow
import React from "react";
import { withRouter } from "react-router-dom";
import { connect } from "react-redux";
import { Form, Input, Select, Button, Card, InputNumber } from "antd";
import {
  getUsers,
  getEditableTeams,
  createProject,
  getProject,
  updateProject,
} from "admin/admin_rest_api";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";

import type { APIUserType, APITeamType } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import type { RouterHistory } from "react-router-dom";

const FormItem = Form.Item;
const Option = Select.Option;

type StateProps = {
  activeUser: APIUserType,
};

type Props = {
  form: Object,
  projectName?: string,
  history: RouterHistory,
} & StateProps;

type State = {
  teams: Array<APITeamType>,
  users: Array<APIUserType>,
};

class ProjectCreateView extends React.PureComponent<Props, State> {
  state = {
    teams: [],
    users: [],
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async fetchData() {
    const [users, teams] = await Promise.all([getUsers(), getEditableTeams()]);

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
    const title =
      isEditMode && this.props.projectName
        ? `Update Project ${this.props.projectName}`
        : "Create Project";
    const fullWidth = { width: "100%" };

    return (
      <div className="row container project-administration">
        <Card title={<h3>{title}</h3>}>
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
                    <Option key={team.id} value={team.id}>
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

            <FormItem>
              <Button type="primary" htmlType="submit">
                {title}
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: enforceActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(withRouter(Form.create()(ProjectCreateView)));
