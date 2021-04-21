// @flow
import { withRouter } from "react-router-dom";
import { Form, Button, Card, Input, Row } from "antd";
import { MailOutlined, TagOutlined } from "@ant-design/icons";
import React from "react";
import { FormInstance } from "antd/lib/form";

import { confirmAsync } from "dashboard/dataset/helper_components";
import { getOrganization, deleteOrganization, updateOrganization } from "admin/admin_rest_api";
import Enum from "Enumjs";

const FormItem = Form.Item;

export const PricingPlanEnum = Enum.make({
  Basic: "Basic",
  Premium: "Premium",
  Pilot: "Pilot",
  Custom: "Custom",
});
type PricingPlan = $Keys<typeof PricingPlanEnum>;

type Props = { organizationName: string };

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

  formRef = React.createRef<typeof FormInstance>();

  componentDidMount() {
    this.fetchData();
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (this.formRef.current != null) {
      // initialValues only works on the first render. Afterwards, values need to be updated
      // using setFieldsValue
      if (
        prevState.displayName.length === 0 &&
        this.state.displayName.length > 0 &&
        this.formRef.current.getFieldValue("displayName") !== this.state.displayName
      ) {
        this.formRef.current.setFieldsValue({ displayName: this.state.displayName });
      }
      if (
        prevState.newUserMailingList.length === 0 &&
        this.state.newUserMailingList.length > 0 &&
        this.formRef.current.getFieldValue("newUserMailingList") !== this.state.newUserMailingList
      ) {
        this.formRef.current.setFieldsValue({ newUserMailingList: this.state.newUserMailingList });
      }
    }
  }

  async fetchData() {
    this.setState({ isFetchingData: true });
    const { displayName, newUserMailingList, pricingPlan } = await getOrganization(
      this.props.organizationName,
    );
    this.setState({
      displayName,
      pricingPlan: Enum.coalesce(PricingPlanEnum, pricingPlan),
      newUserMailingList,
      isFetchingData: false,
    });
  }

  onFinish = async formValues => {
    await updateOrganization(
      this.props.organizationName,
      formValues.displayName,
      formValues.newUserMailingList,
    );
    window.location.replace(`${window.location.origin}/dashboard/`);
  };

  handleDeleteButtonClicked = async (): Promise<void> => {
    const isDeleteConfirmed = await confirmAsync({
      title: (
        <p>
          Deleting an organization cannot be undone. Are you certain you want to delete the
          organization {this.state.displayName}? <br />
          Attention: You will be logged out.
        </p>
      ),
      okText: "Yes, Delete Organization now",
    });
    if (isDeleteConfirmed) {
      this.setState({ isDeleting: true });
      await deleteOrganization(this.props.organizationName);
      this.setState({ isDeleting: false });
      window.location.replace(`${window.location.origin}/dashboard`);
    }
  };

  render() {
    return (
      <div className="container" style={{ paddingTop: 20 }}>
        <Card
          title={<h3>Edit {this.state.displayName} </h3>}
          style={{ margin: "auto", maxWidth: 800 }}
        >
          <Form
            onFinish={this.onFinish}
            layout="vertical"
            ref={this.formRef}
            initialValues={{
              displayName: this.state.displayName,
              newUserMailingList: this.state.newUserMailingList,
            }}
          >
            <FormItem
              label="Display Name"
              name="displayName"
              rules={[
                {
                  required: true,
                  pattern: "^[A-Za-z0-9\\-_\\. ß]+$",
                  message:
                    "The organization name must not contain any special characters and can not be empty.",
                },
              ]}
            >
              <Input
                prefix={<TagOutlined />}
                autoFocus
                disabled={this.state.isFetchingData}
                placeholder="Display Name"
              />
            </FormItem>{" "}
            <FormItem
              label="Notify About New Users Via:"
              name="newUserMailingList"
              rules={[
                {
                  required: false,
                  type: "email",
                },
              ]}
            >
              <Input
                prefix={<MailOutlined style={{ fontSize: 13 }} />}
                disabled={this.state.isFetchingData}
                placeholder="mail@example.com"
              />
            </FormItem>
            <FormItem>
              <div className="ant-form-item-label" style={{ paddingTop: 5 }}>
                <label style={{ paddingRight: 20 }}>Pricing Plan</label>
                <span className="bordered" style={{ cursor: "default" }}>
                  {this.state.pricingPlan}
                </span>
              </div>
            </FormItem>
            <Row type="flex" justify="center">
              <FormItem style={{ marginRight: 20 }}>
                <Button type="primary" htmlType="submit" disabled={this.state.isFetchingData}>
                  Save
                </Button>
              </FormItem>
              <Button
                type="danger"
                loading={this.state.isDeleting}
                onClick={this.handleDeleteButtonClicked}
                disabled={this.state.isFetchingData}
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

export default withRouter(OrganizationEditView);
