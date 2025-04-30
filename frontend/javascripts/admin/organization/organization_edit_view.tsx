import {
  CopyOutlined,
  IdcardOutlined,
  MailOutlined,
  SaveOutlined,
  TagOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  deleteOrganization,
  getPricingPlanStatus,
  getUsers,
  updateOrganization,
} from "admin/rest_api";
import { Button, Card, Col, Form, Input, Row, Skeleton, Space, Typography } from "antd";
import { confirmAsync } from "dashboard/dataset/helper_components";
import Toast from "libs/toast";
import { enforceActiveOrganization } from "oxalis/model/accessors/organization_accessors";
import type { OxalisState } from "oxalis/store";
import { useEffect, useState } from "react";
import { connect } from "react-redux";
import type { APIOrganization, APIPricingPlanStatus } from "types/api_types";
import {
  PlanAboutToExceedAlert,
  PlanDashboardCard,
  PlanExceededAlert,
  PlanExpirationCard,
  PlanUpgradeCard,
} from "./organization_cards";
import { getActiveUserCount } from "./pricing_plan_utils";

const FormItem = Form.Item;

type Props = {
  organization: APIOrganization;
};

type FormValues = {
  displayName: string;
  newUserMailingList: string;
};

const OrganizationEditView = ({ organization }: Props) => {
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeUsersCount, setActiveUsersCount] = useState(1);
  const [pricingPlanStatus, setPricingPlanStatus] = useState<APIPricingPlanStatus | null>(null);

  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setIsFetchingData(true);
    const [users, pricingPlanStatus] = await Promise.all([getUsers(), getPricingPlanStatus()]);

    setPricingPlanStatus(pricingPlanStatus);
    setActiveUsersCount(getActiveUserCount(users));
    setIsFetchingData(false);
  }

  async function onFinish(formValues: FormValues) {
    await updateOrganization(
      organization.id,
      formValues.displayName,
      formValues.newUserMailingList,
    );
    Toast.success("Organization settings were saved successfully.");
  }

  async function handleDeleteButtonClicked(): Promise<void> {
    const isDeleteConfirmed = await confirmAsync({
      title: "Danger Zone",
      content: (
        <div>
          <Typography.Title level={4} type="danger">
            You will lose access to all the datasets and annotations uploaded/created as part of
            this organization!
          </Typography.Title>
          <Typography.Title level={4} type="danger">
            Unless you are part of another WEBKNOSSOS organization, you can NOT login again with
            this account and will lose access to WEBKNOSSOS.
          </Typography.Title>
          <p>
            Deleting an organization{" "}
            <Typography.Text type="danger">cannot be undone</Typography.Text>. Are you certain you
            want to delete the organization {organization.name}?
          </p>
        </div>
      ),
      okText: <>Yes, delete this organization now and log me out.</>,
      okType: "danger",
      width: 500,
    });

    if (isDeleteConfirmed) {
      setIsDeleting(true);
      await deleteOrganization(organization.id);
      setIsDeleting(false);
      window.location.replace(`${window.location.origin}/dashboard`);
    }
  }

  async function handleCopyNameButtonClicked(): Promise<void> {
    await navigator.clipboard.writeText(organization.id);
    Toast.success("Copied organization name to the clipboard.");
  }

  const OrgaNameRegexPattern = /^[A-Za-z0-9\\-_\\. ß]+$/;

  if (isFetchingData || !organization || !pricingPlanStatus)
    return (
      <div
        className="container"
        style={{
          paddingTop: 40,
          margin: "auto",
          maxWidth: 800,
        }}
      >
        <Skeleton active />
      </div>
    );

  return (
    <div
      className="container"
      style={{
        paddingTop: 20,
        margin: "auto",
        maxWidth: 800,
      }}
    >
      <Row style={{ color: "#aaa", fontSize: " 12" }}>Your Organization</Row>
      <Row style={{ marginBottom: 20 }}>
        <h2>{organization.name}</h2>
      </Row>
      {pricingPlanStatus.isExceeded ? <PlanExceededAlert organization={organization} /> : null}
      {pricingPlanStatus.isAlmostExceeded && !pricingPlanStatus.isExceeded ? (
        <PlanAboutToExceedAlert organization={organization} />
      ) : null}
      <PlanDashboardCard organization={organization} activeUsersCount={activeUsersCount} />
      <PlanExpirationCard organization={organization} />
      <PlanUpgradeCard organization={organization} />
      <Card title="Settings" style={{ marginBottom: 20 }}>
        <Form
          form={form}
          onFinish={onFinish}
          layout="vertical"
          initialValues={{
            displayName: organization.name,
            newUserMailingList: organization.newUserMailingList,
          }}
        >
          <FormItem label="Organization ID">
            <Space.Compact>
              <Input
                prefix={<IdcardOutlined />}
                value={organization.id}
                style={{
                  width: "calc(100% - 31px)",
                }}
                readOnly
                disabled
              />
              <Button onClick={handleCopyNameButtonClicked} icon={<CopyOutlined />} />
            </Space.Compact>
          </FormItem>
          <FormItem label="Organization Owner">
            <Input prefix={<UserOutlined />} value={organization.ownerName} readOnly disabled />
          </FormItem>
          <FormItem
            label="Organization Name"
            name="displayName"
            rules={[
              {
                required: true,
                pattern: OrgaNameRegexPattern,
                message:
                  "Organization names must not contain any special characters and can not be empty.",
              },
            ]}
          >
            <Input prefix={<TagOutlined />} disabled={isFetchingData} placeholder="Display Name" />
          </FormItem>
          <FormItem
            label="Email Address for New-User Notifications"
            name="newUserMailingList"
            rules={[
              {
                required: false,
                type: "email",
                message: "Please provide a valid email address.",
              },
            ]}
          >
            <Input
              prefix={
                <MailOutlined
                  style={{
                    fontSize: 13,
                  }}
                />
              }
              disabled={isFetchingData}
              placeholder="mail@example.com"
            />
          </FormItem>
          <Button
            type="primary"
            htmlType="submit"
            disabled={isFetchingData}
            icon={<SaveOutlined />}
          >
            Save
          </Button>
        </Form>
      </Card>
      <Card title="Danger Zone" style={{ marginBottom: 20 }}>
        <Row>
          <Col span={18}>
            Delete this organization including all annotations, uploaded datasets, and associated
            user accounts. Careful, this action can NOT be undone.
          </Col>
          <Col span={6}>
            <Button
              danger
              loading={isDeleting}
              onClick={handleDeleteButtonClicked}
              disabled={isFetchingData}
            >
              Delete Organization
            </Button>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

const mapStateToProps = (state: OxalisState): Props => ({
  organization: enforceActiveOrganization(state.activeOrganization),
});
export default connect(mapStateToProps)(OrganizationEditView);
