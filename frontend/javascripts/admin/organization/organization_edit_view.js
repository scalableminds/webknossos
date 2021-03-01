// @flow
import { withRouter } from "react-router-dom";
import { Form, Button, Card, Radio, Input, Icon, Row } from "antd";
import React from "react";

import { confirmAsync } from "dashboard/dataset/helper_components";
import { getOrganization, deleteOrganization, updateOrganization } from "admin/admin_rest_api";
import Enum from "Enumjs";

const FormItem = Form.Item;
const RadioGroup = Radio.Group;

export const PricingPlanEnum = Enum.make({
  Basic: "Basic",
  Premium: "Premium",
  Pilot: "Pilot",
  Custom: "Custom",
});
type PricingPlan = $Keys<typeof PricingPlanEnum>;

type Props = { organizationName: string, form: Object };

type State = {
  displayName: string,
  newUserMailingList: string,
  pricingPlan: ?PricingPlan,
  isFetchingData: boolean,
  isDeleting: boolean,
};

class OrganizationEditView extends React.PureComponent<Props, State> {
  state = {
    displayName: "",
    newUserMailingList: "",
    pricingPlan: null,
    isFetchingData: false,
    isDeleting: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    if (this.props.organizationName) {
      this.setState({ isFetchingData: true });
      const { displayName, newUserMailingList, pricingPlan } = await getOrganization(
        this.props.organizationName,
      );
      this.setState({ displayName, pricingPlan, newUserMailingList, isFetchingData: false });
    }
  }

  handleSubmit = e => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        await updateOrganization(
          this.props.organizationName,
          formValues.displayName,
          formValues.newUserMailingList,
        );
        window.location.replace(`${window.location.origin}/dashboard/datasets`);
      }
    });
  };

  handleDeleteButtonClicked = async (): Promise<void> => {
    const isDeleteConfirmed = await confirmAsync({
      title: `Deleting an organization cannot be undone. Are you certain you want to delete the organization ${
        this.state.displayName
      }?`,
      okText: "Yes, Delete Organization now",
    });
    if (isDeleteConfirmed) {
      this.setState({ isDeleting: true });
      await deleteOrganization(this.props.organizationName);
      this.setState({ isDeleting: false });
      window.location.replace(`${window.location.origin}/dashboard`);
    }
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
                initialValue: this.state.displayName,
              })(<Input icon="tag-o" autoFocus />)}
            </FormItem>
            <FormItem label="Billing Plan">
              {getFieldDecorator("pricingPlan", {
                initialValue: this.state.pricingPlan,
              })(
                <RadioGroup>
                  <Radio value={PricingPlanEnum.Basic} disabled={this.state.isFetchingData}>
                    Basic
                  </Radio>
                  <Radio value={PricingPlanEnum.Pilot} disabled={this.state.isFetchingData}>
                    Pilot
                  </Radio>
                  <Radio value={PricingPlanEnum.Premium} disabled={this.state.isFetchingData}>
                    Premium
                  </Radio>
                  <Radio value={PricingPlanEnum.Custom} disabled={this.state.isFetchingData}>
                    Custom
                  </Radio>
                </RadioGroup>,
              )}
            </FormItem>
            <FormItem>
              {getFieldDecorator("newUserMailingList", {
                rules: [
                  {
                    required: false,
                    type: "email",
                  },
                ],
                initialValue: this.state.newUserMailingList,
              })(<Input prefix={<Icon type="mail" style={{ fontSize: 13 }} />} />)}
            </FormItem>
            <Row type="flex" justify="space-between">
              <FormItem>
                <Button type="primary" htmlType="submit">
                  Submit Changes
                </Button>
              </FormItem>
              <Button
                type="danger"
                loading={this.state.isDeleting}
                onClick={this.handleDeleteButtonClicked}
              >
                Delete Organization
              </Button>
            </Row>
          </Form>
        </Card>
      </div>
    );
  }
}

export default withRouter(Form.create()(OrganizationEditView));
