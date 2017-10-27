// @flow
import React from "react";
import { Form, Input, Select, Button, Card } from "antd";
import app from "app";
import {
  getActiveDatasets,
  getProjects,
  getAdminTeams,
  getScripts,
  getTaskTypes,
} from "admin/admin_rest_api";
import type {
  APIDatasetType,
  APITaskTypeType,
  APIProjectType,
  APIScriptType,
  APITeamType,
} from "admin/api_flow_types";

import DatasetCollection from "admin/models/dataset/dataset_collection";
import SelectionView from "admin/views/selection_view";
import Utils from "libs/utils";

const FormItem = Form.Item;
const Option = Select.Option;
const CLEAR_ON_SUCCESS = true;

type Props = {
  form: Object,
};

type State = {
  datasets: Array<APIDatasetType>,
  taskTypes: Array<APITaskTypeType>,
  projects: Array<APIProjectType>,
  scripts: Array<APIScriptType>,
  teams: Array<APITeamType>,
};

class TaskCreateFormView extends React.PureComponent<Props, State> {
  state = {
    datasets: [],
    taskTypes: [],
    projects: [],
    scripts: [],
    teams: [],
  };
  componentDidMount() {
    this.fetchData();
    // this.applyDefaults();
  }

  async fetchData() {
    const [datasets, projects, teams, scripts, taskTypes] = await Promise.all([
      getActiveDatasets(),
      getProjects(),
      getAdminTeams(),
      getScripts(),
      getTaskTypes(),
    ]);

    this.setState({ datasets, projects, teams, scripts, taskTypes });
  }

  handleSubmit(event) {
    // event.preventDefault();
    // const serializedForm = this.serializeForm();
    // // unblock submit button after model synched
    // // show a status flash message
    // try {
    //   const method = this.parent.isEditingMode ? "PUT" : "POST";
    //   const response = await Request.sendJSONReceiveJSON(this.model.url(), {
    //     method,
    //     data: serializedForm,
    //     params: { type: "default" },
    //   });
    //   if (this.parent.isEditingMode) {
    //     app.router.loadURL("/tasks");
    //   } else {
    //     this.parent.showSaveSuccess(response);
    //   }
    // } catch (e) {
    //   this.parent.showSaveError();
    // }
  }

  render() {
    const { getFieldDecorator } = this.props.form;
    const isEditingMode = true;
    const taskInstancesLabel = isEditingMode ? "Remaining Instances" : "Task Instances";

    return (
      <div className="container wide" style={{ paddingTop: 20 }}>
        <Card title={<h3>Create Task</h3>}>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="TaskType" hasFeedback>
              {getFieldDecorator("taskType", {
                rules: [{ required: true }],
              })(
                <Select
                  showSearch
                  placeholder="Select a TaskType"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                  autoFocus
                >
                  {this.state.taskTypes.map((taskType: APITaskTypeType) => (
                    <Option key={taskType.id} value={taskType.id}>
                      {taskType.summary}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem label="Experience Domain" hasFeedback>
              {getFieldDecorator("neededExperience", {
                rules: [{ required: true }, { min: 3 }],
              })(<Input />)}
            </FormItem>

            <FormItem label={taskInstancesLabel} hasFeedback>
              {getFieldDecorator("status.open", {
                rules: [{ required: true }, { type: "number", min: 3 }],
              })(<Input />)}
            </FormItem>

            <FormItem label="Team" hasFeedback>
              {getFieldDecorator("team", {
                rules: [{ required: true }],
              })(
                <Select
                  showSearch
                  placeholder="Select a Team"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                  autoFocus
                >
                  {this.state.teams.map((team: APITeamType) => (
                    <Option key={team.id} value={team.name}>
                      {team.name}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem label="Project" hasFeedback>
              {getFieldDecorator("projectName", {
                rules: [{ required: true }],
              })(
                <Select
                  showSearch
                  placeholder="Select a Project"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                  autoFocus
                >
                  {this.state.projects.map((project: APIProjectType) => (
                    <Option key={project.id} value={project.name}>
                      {project.name}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem label="Script" hasFeedback>
              {getFieldDecorator("scriptId", {
                rules: [{ required: true }],
              })(
                <Select
                  showSearch
                  placeholder="Select a Project"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                  autoFocus
                >
                  {this.state.scripts.map((script: APIScriptType) => (
                    <Option key={script.id} value={script.id}>
                      {script.name}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem label="Bounding Box" hasFeedback>
              {getFieldDecorator("boundingBox", {
                rules: [{ required: true }],
              })(<Input />)}
            </FormItem>

            <FormItem>
              <Button type="primary" htmlType="submit">
                Create Task
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );

    //       <div className="create-from-form">
    // <div class=" form-group">
    //   <label class="col-sm-2 control-label" for="dataSet">Dataset</label>
    //   <div class="col-sm-9 dataSet">
    //   </div>
    // </div>

    // <div class=" form-group">
    //   <label class="col-sm-2 control-label" for="editPosition">Start</label>
    //   <div class="col-sm-9">
    //     <input
    //       type="text"
    //       id="editPosition"
    //       name="editPosition"
    //       placeholder="x, y, z"
    //       title="x, y, z"
    //       pattern="(\\s*\\d+\\s*,){2}(\\s*\\d+\\s*)"
    //       value="<%- editPosition %>"
    //       required
    //       class="form-control">
    //   </div>
    // </div>

    // <div class=" form-group">
    //   <label class="col-sm-2 control-label" for="editRotation">Start Rotation</label>
    //   <div class="col-sm-9">
    //     <input
    //       type="text"
    //       id="editRotation"
    //       name="editRotation"
    //       placeholder="Rotation x, Rotation y, Rotation z"
    //       title="Rotation x, Rotation y, Rotation z"
    //       pattern="(\\s*\\d+\\s*,){2}(\\s*\\d+\\s*)"
    //       value="<%- editRotation %>"
    //       required
    //       class="form-control">
    //   </div>
    // </div>
    return;
  }

  // const formValues = this.parent.serializeForm();
  // formValues.editPosition = Utils.stringToNumberArray(this.ui.editPosition.val());
  // formValues.editRotation = Utils.stringToNumberArray(this.ui.editRotation.val());

  // return formValues;
}

export default Form.create()(TaskCreateFormView);
