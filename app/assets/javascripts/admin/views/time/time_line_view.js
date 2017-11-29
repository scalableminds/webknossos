// @flow
import * as React from "react";
import { Select, Card, Form, Row, Col, DatePicker } from "antd";
import moment from "moment";
import { Chart } from "react-google-charts";
import { getUsers, getTimeTrackingForUserByDay } from "admin/admin_rest_api";

import type { APIUserType, APITimeTrackingType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;

type State = {
  userEmail: ?string,
  users: Array<APIUserType>,
  date: Date,
  timeTrackingData: Array<APITimeTrackingType>,
};

class TimeLineView extends React.PureComponent<*, State> {
  state = {
    userEmail: null,
    users: [],
    date: new Date(),
    timeTrackingData: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const users = await getUsers();
    this.setState({ users });
  }

  async fetchTimeTrackingData() {
    if (this.state.userEmail != null) {
      const timeTrackingData = await getTimeTrackingForUserByDay(
        this.state.userEmail,
        this.state.date,
      );
      this.setState({ timeTrackingData });
    }
  }

  handleUserChange = async (userEmail: string) => {
    await this.setState({ userEmail });
    this.fetchTimeTrackingData();
  };

  handleDateChange = async (date: moment$Moment) => {
    await this.setState({ date: date.toDate() });
    this.fetchTimeTrackingData();
  };

  render() {
    const columns = [
      { id: "AnnotationId", type: "string" },
      { id: "Start", type: "date" },
      { id: "End", type: "date" },
    ];

    const rows = this.state.timeTrackingData.map((datum: APITimeTrackingType) => [
      datum.annotation,
      new Date(datum.timestamp),
      new Date(datum.timestamp + moment.duration(datum.time).asMilliseconds()),
    ]);

    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    return (
      <div className="container wide">
        <Card title={<h4>Time Tracking </h4>}>
          <Row gutter={40}>
            <Col span={12}>
              <FormItem {...formItemLayout} label="User">
                <Select
                  allowClear
                  showSearch
                  placeholder="Select a User"
                  optionFilterProp="children"
                  style={{ width: "100%" }}
                  onChange={this.handleUserChange}
                >
                  {this.state.users.filter(u => u.isActive).map((user: APIUserType) => (
                    <Option key={user.id} value={user.email}>
                      {`${user.lastName}, ${user.firstName} ${user.email}`}
                    </Option>
                  ))}
                </Select>
              </FormItem>
            </Col>
            <Col span={12}>
              <FormItem {...formItemLayout} label="Date">
                <DatePicker
                  allowClear={false}
                  style={{ width: "100%" }}
                  value={moment(this.state.date)}
                  onChange={this.handleDateChange}
                />
              </FormItem>
            </Col>
          </Row>
        </Card>

        <div style={{ marginTop: 20 }}>
          {this.state.timeTrackingData.length > 0 ? (
            <Chart
              chartType="Timeline"
              columns={columns}
              rows={rows}
              graph_id="TimeLineGraph"
              chartPackages={["timeline"]}
              width="100%"
              height="400px"
              legend_toggle
            />
          ) : (
            <div>No TimeTracking Data for the selected User or Day</div>
          )}
        </div>
      </div>
    );
  }
}

export default TimeLineView;
