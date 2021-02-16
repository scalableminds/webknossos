// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Form, Button, Card, Radio, Input, Spin } from "antd";
import React from "react";
import _ from "lodash";

import type { BoundingBoxObject } from "oxalis/store";
import type { Vector6 } from "oxalis/constants";
import Enum from "Enumjs";

const FormItem = Form.Item;
const RadioGroup = Radio.Group;

type Props = {
  form: Object,
  history: RouterHistory,
};

export const PlanEnum = Enum.make({
  Basic: "Basic",
  Premium: "Premium",
  Pilot: "Pilot",
});
type Plan = $Keys<typeof PlanEnum>;

type State = {
  displayName: string,
  plan: Plan,
  isUploading: boolean,
  isFetchingData: boolean,
};

class OrganizationEditView extends React.PureComponent<Props, State> {
  state = {
    displayName: "",
    isUploading: false,
    plan: PlanEnum.Basic,
    isFetchingData: false,
  };

  componentDidMount() {
    this.fetchData();
    this.applyDefaults();
  }

  async fetchData() {
    this.setState({ isFetchingData: true });
    const plan = PlanEnum.Basic;
    const displayName = "Display Name";
    /* const [datasets, projects, scripts, taskTypes] = await Promise.all([
      getActiveDatasets(),
      getProjects(),
      getScripts(),
      getTaskTypes(),
    ]); */
    this.setState({ plan, displayName, isFetchingData: false });
  }

  async applyDefaults() {
    const plan = PlanEnum.Basic;
    const displayName = "Display Name One";
    this.setState({ plan, displayName, isFetchingData: false });
  }

  transformBoundingBox(boundingBox: Vector6): BoundingBoxObject {
    return {
      topLeft: [boundingBox[0] || 0, boundingBox[1] || 0, boundingBox[2] || 0],
      width: boundingBox[3] || 0,
      height: boundingBox[4] || 0,
      depth: boundingBox[5] || 0,
    };
  }

  handleSubmit = e => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        console.log("Everything's fine", formValues);
      }
    });
  };

  normFile = e => {
    if (Array.isArray(e)) {
      return e;
    }
    return e && e.fileList;
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <div className="container" style={{ paddingTop: 20 }}>
        <Spin spinning={this.state.isUploading}>
          <Card title={<h3>Edit {this.state.displayName}</h3>}>
            <Form onSubmit={this.handleSubmit} layout="vertical">
              <FormItem label="Display Name">
                {getFieldDecorator("displayName", {
                  rules: [
                    {
                      required: true,
                      pattern: "^[A-Za-z0-9\\-_\\. ß]+$",
                      message: "The organization name must not contain any special characters.",
                    },
                  ],
                })(<Input icon="tag-o" placeholder={this.state.displayName} autoFocus />)}
              </FormItem>
              <FormItem label="Billing Plan">
                {getFieldDecorator("billingPlan", {
                  initialValue: this.state.plan,
                })(
                  <RadioGroup>
                    <Radio value={PlanEnum.Basic} disabled={this.state.isFetchingData}>
                      Basic
                    </Radio>
                    <Radio value={PlanEnum.Pilot} disabled={this.state.isFetchingData}>
                      Pilot
                    </Radio>
                    <Radio value={PlanEnum.Premium} disabled={this.state.isFetchingData}>
                      Premium
                    </Radio>
                  </RadioGroup>,
                )}
              </FormItem>

              <FormItem>
                <Button type="primary" htmlType="submit">
                  Submit Changes
                </Button>
              </FormItem>
            </Form>
          </Card>
        </Spin>
      </div>
    );
  }
}

export default withRouter(Form.create()(OrganizationEditView));
