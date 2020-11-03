// @flow
import { Form, Input, Select, Button, Card, InputNumber, Checkbox, Spin } from "antd";
import { type RouterHistory, withRouter } from "react-router-dom";
import { connect } from "react-redux";
import React from "react";

import type { APIUser, APITeam } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import {
  getUsers,
  getEditableTeams,
  createProject,
  getProject,
  updateProject,
} from "admin/admin_rest_api";

import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;
const { Option } = Select;

type OwnProps = {|
  projectName?: ?string,
|};
type StateProps = {|
  activeUser: APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {|
  ...Props,
  form: Object,
  history: RouterHistory,
|};

type State = {
  teams: Array<APITeam>,
  users: Array<APIUser>,
  isFetchingData: boolean,
};

class ProjectCreateView extends React.PureComponent<PropsWithRouter, State> {
  state = {
    teams: [],
    users: [],
    isFetchingData: false,
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async fetchData() {
    this.setState({ isFetchingData: true });
    const [users, teams] = await Promise.all([getUsers(), getEditableTeams()]);
    this.setState({
      users: users.filter(user => user.isActive),
      teams,
      isFetchingData: false,
    });
  }

  async applyDefaults() {
    const project = this.props.projectName ? await getProject(this.props.projectName) : null;
    const defaultValues = {
      priority: 100,
      expectedTime: 90,
      isBlacklistedFromReport: false,
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
                    pattern: "^[a-zA-Z0-9_-]*$",
                    message: "The project name must not contain whitespace or special characters.",
                  },
                  {
                    min: 3,
                    required: true,
                    message: "The project name must be at least 3 characters long.",
                  },
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
                  notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                >
                  {this.state.teams.map((team: APITeam) => (
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
                  notFoundContent={this.state.isFetchingData ? <Spin size="small" /> : "No Data"}
                >
                  {this.state.users.map((user: APIUser) => (
                    <Option key={user.id} value={user.id}>
                      {`${user.lastName}, ${user.firstName} (${user.email})`}
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

            <FormItemWithInfo
              label="Visibility in Project Progress View"
              info="If checked, the project will not be listed in the project progress view."
            >
              {getFieldDecorator("isBlacklistedFromReport", { valuePropName: "checked" })(
                <Checkbox>Do not show in Project Progress View</Checkbox>,
              )}
            </FormItemWithInfo>

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

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(
  withRouter(Form.create()(ProjectCreateView)),
);
