// @flow
import * as React from "react";
import moment from "moment";
import { Select, Card, Form, Row, Col, DatePicker } from "antd";
import { Chart } from "react-google-charts";
import FormatUtils from "libs/format_utils";
import { getUsers, getTimeTrackingForUserByDay } from "admin/admin_rest_api";

import type { APIUserType, APITimeTrackingType } from "admin/api_flow_types";

const FormItem = Form.Item;
const Option = Select.Option;

type State = {
  user: ?APIUserType,
  users: Array<APIUserType>,
  date: moment$Moment,
  timeTrackingData: Array<APITimeTrackingType>,
};

class TimeLineView extends React.PureComponent<*, State> {
  state = {
    user: null,
    users: [],
    date: moment(),
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
    if (this.state.user != null) {
      const timeTrackingData = await getTimeTrackingForUserByDay(
        this.state.user.email,
        this.state.date,
      );
      this.setState({ timeTrackingData });
    }
  }

  handleUserChange = async (userId: number) => {
    const user = this.state.users.find(u => u.id === userId);
    await this.setState({ user });
    this.fetchTimeTrackingData();
  };

  handleDateChange = async (date: moment$Moment) => {
    await this.setState({ date });
    this.fetchTimeTrackingData();
  };

  render() {
    const columns = [
      { id: "AnnotationId", type: "string" },
      { id: "Start", type: "date" },
      { id: "End", type: "date" },
    ];

    let timeTrackingSum = 0;
    const timeTrackingRowGrouped = []; // shows each time span grouped by annotation id
    const timeTrackingRowTotal = []; // show all times spans in a single row

    this.state.timeTrackingData.forEach((datum: APITimeTrackingType) => {
      const duration = moment.duration(datum.time).asMilliseconds();
      const start = new Date(datum.timestamp);
      const end = new Date(datum.timestamp + duration);

      timeTrackingSum += duration;
      timeTrackingRowGrouped.push([datum.annotation, start, end]);
      timeTrackingRowTotal.push(["Sum Tracking Time", start, end]);
    });

    const rows = timeTrackingRowTotal.concat(timeTrackingRowGrouped);

    const formItemLayout = {
      labelCol: { span: 5 },
      wrapperCol: { span: 19 },
    };

    return (
      <div className="container wide">
        <Card title={<h4>Time Tracking </h4>}>
          <p>
            The time tracking information display here only includes data acquired when working on
            &quot;tasks&quot;.
          </p>
          {this.state.user != null ? (
            <p>{`${this.state.user.firstName} worked ${FormatUtils.formatSeconds(
              timeTrackingSum / 1000,
            )} on ${this.state.date.format("dddd")}, ${this.state.date.format("DD.MM.YYYY")}.`}</p>
          ) : null}
          <hr />
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
                    <Option key={user.id} value={user.id}>
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
              height="600px"
              legend_toggle
            />
          ) : (
            <div style={{ textAlign: "center" }}>
              No Time Tracking Data for the Selected User or Day.
            </div>
          )}
        </div>
      </div>
    );
  }
}

export default TimeLineView;
