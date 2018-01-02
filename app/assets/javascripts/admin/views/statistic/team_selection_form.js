// @flow
import * as React from "react";
import { Row, Col, Form, Select, Button } from "antd";
import { getTeams } from "admin/admin_rest_api";
import type { APITeamType } from "admin/api_flow_types";

const FormItem = Form.Item;
const { Option } = Select;

type Props = {
  form: Object,
  onChange: (teamId: string) => void,
};
type State = {
  teams: Array<APITeamType>,
};

class TeamSelectionView extends React.PureComponent<Props, State> {
  state = {
    teams: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const teams = await getTeams();
    this.setState({ teams });
  }

  handleFormSubmit = (event: ?SyntheticInputEvent<*>) => {
    if (event) {
      event.preventDefault();
    }
    this.props.form.validateFields((err, formValues) => {
      this.props.onChange(formValues.teamId);
    });
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
            <FormItem {...formItemLayout} label="Team" style={{ marginBottom: 0 }}>
              {getFieldDecorator("teamId")(
                <Select
                  allowClear
                  showSearch
                  placeholder="Select a Team"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                >
                  {this.state.teams.map((team: APITeamType) => (
                    <Option key={team.id} value={team.id}>
                      {team.name}
                    </Option>
                  ))}
                </Select>,
              )}
            </FormItem>
          </Col>
          <Col span={12}>
            <Button type="primary" htmlType="submit">
              Search
            </Button>
          </Col>
        </Row>
      </Form>
    );
  }
}

export default Form.create()(TeamSelectionView);
