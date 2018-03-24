// @flow
import React from "react";
import { Form, Input, Select, Button, Card } from "antd";
import { getEditableTeams, addNDStoreDataset } from "admin/admin_rest_api";
import Toast from "libs/toast";
import messages from "messages";
import { withRouter } from "react-router-dom";

import type { APITeamType, NDStoreConfigType } from "admin/api_flow_types";
import type { RouterHistory } from "react-router-dom";

const FormItem = Form.Item;
const Option = Select.Option;

type Props = {
  form: Object,
  history: RouterHistory,
};

type State = {
  teams: Array<APITeamType>,
};

class DatasetRemoteView extends React.PureComponent<Props, State> {
  state = {
    teams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const teams = await getEditableTeams();
    this.setState({
      teams,
    });
  }

  handleSubmit = evt => {
    evt.preventDefault();

    this.props.form.validateFields(async (err, formValues: NDStoreConfigType) => {
      if (!err) {
        await addNDStoreDataset(formValues);

        Toast.success(messages["dataset.ndstore_success"]);
        this.props.history.push("/dashboard");
      }
    });
  };
  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <div style={{ padding: 5 }}>
        <Card title={<h3>Add Remote NDStore Dataset</h3>}>
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <FormItem label="Dataset Name" hasFeedback>
              {getFieldDecorator("name", {
                rules: [{ required: true }, { min: 3 }, { pattern: /[0-9a-zA-Z_-]+$/ }],
              })(<Input autoFocus />)}
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
                >
                  {this.state.teams.map((team: APITeamType) => (
                    <Option key={team.id} value={team.id}>
                      {`${team.name}`}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>

            <FormItem label="Server Url" hasFeedback>
              {getFieldDecorator("server", {
                rules: [{ required: true, type: "url" }],
              })(<Input />)}
            </FormItem>

            <FormItem label="Token" hasFeedback>
              {getFieldDecorator("token", {
                rules: [{ required: true }],
              })(<Input />)}
            </FormItem>

            <FormItem>
              <Button type="primary" htmlType="submit">
                Add Dataset from NDStore
              </Button>
            </FormItem>
          </Form>
        </Card>
      </div>
    );
  }
}

export default withRouter(Form.create()(DatasetRemoteView));
