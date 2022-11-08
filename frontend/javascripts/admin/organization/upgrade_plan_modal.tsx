import React from "react";
import { Divider, InputNumber, Modal} from "antd";
import {
  DatabaseOutlined,
  FieldTimeOutlined,
  RocketOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { teamPlanFeatures } from "./pricing_plan_utils";
import { APIOrganization } from "types/api_flow_types";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import moment from "moment";

function handlePlanUpgrade() {
  // TODO
  console.log("Request upgrade");
}

function handleExtendPlan() {
  // TODO
  console.log("Extend Plan");
}

function handleUserUpgrade() {
  // TODO
  console.log("Upgrade users");
}

function handleStorageUpgrade() {
  // TODO
  console.log("Upgrade storage");
}

function extendPricingPlan(organization: APIOrganization) {
  const extendedDate = moment(organization.paidUntil).add(1, "year")

  Modal.confirm({
    title: "Extend Current Plan",
    okText: "Request Extension",
    onOk: handleExtendPlan,
    icon: <FieldTimeOutlined style={{ color: "var(--ant-primary-color)" }} />,
    width: 1000,
    content: (
      <div
        style={{
          background:
            "right -150px / 50% no-repeat url(/assets/images/pricing/background_neurons.png)",
        }}
      >
        <p style={{ marginRight: "30%" }}>
          webKnossos plans are billed annually. Extend your plan now for uninterrupted access to webKnossos. 
        </p>
        <p>
          Your current plan is paid until:{" "}
          {formatDateInLocalTimeZone(organization.paidUntil, "YYYY-MM-DD")}
        </p>
        <p>Buy extension until: {extendedDate.format("YYYY-MM-DD")}</p>
        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an extension will send an email to the webKnossos sales team to extend your
          current plan. We typically respond within one business day. See our{" "}
          <a href="https://webknossos.org/faq">FAQ</a> for more information.
        </p>
      </div>
    ),
  });
}

function upgradeUserQuota() {
  Modal.confirm({
    title: "Upgrade User Quota",
    okText: "Request More Users",
    onOk: handleUserUpgrade,
    icon: <UserAddOutlined style={{ color: "var(--ant-primary-color)" }} />,
    width: 1000,
    content: (
      <div
        style={{
          background:
            "right -50px / 35% no-repeat url(/assets/images/pricing/background_users.png)",
        }}
      >
        <p style={{ marginRight: "30%" }}>
          You can increase the number of users allowed to join your organization by either buying
          single user upgrades or by upgrading your webKnossos plan to 'Power' for unlimited users.
        </p>
        <div>Add additional user accounts:</div>
        <div>
          <InputNumber min={1} defaultValue={1} />
        </div>

        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an upgrade to your organization&apos;s user quota will send an email to the
          webKnossos sales team. We typically respond within one business day. See our{" "}
          <a href="https://webknossos.org/faq">FAQ</a> for more information.
        </p>
      </div>
    ),
  });
}

function upgradeStorageQuota() {
  Modal.confirm({
    title: "Upgrade Storage Space",
    okText: "Request More Storage Space",
    onOk: handleStorageUpgrade,
    icon: <DatabaseOutlined style={{ color: "var(--ant-primary-color)" }} />,
    width: 1000,
    content: (
      <div
        style={{
          background:
            "right -30px / 35% no-repeat url(/assets/images/pricing/background_evaluation.png)",
        }}
      >
        <p style={{ marginRight: "30%" }}>
          You can increase your storage limit for your organization by either buying additional
          storage upgrades or by upgrading your webKnossos plan to 'Power' for custom dataset
          hosting solution, e.g. streaming data from your storage server / the cloud.
        </p>
        <div>Add additional storage (in Terabyte):</div>
        <div>
          <InputNumber min={1} defaultValue={1} />
        </div>
        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an upgrade to your organization&apos;s storage quota will send an email to the
          webKnossos sales team. We typically respond within one business day. See our{" "}
          <a href="https://webknossos.org/faq">FAQ</a> for more information.
        </p>
      </div>
    ),
  });
}

function upgradePricingPlan() {
  const title = "Upgrade to Team Plan";
  const introSentence =
    "Upgrading your webKnossos plan will unlock more advanced features and increase your user and storage quotas.";
  const featureDescriptions = teamPlanFeatures;

  Modal.confirm({
    title,
    okText: "Request Upgrade",
    onOk: handlePlanUpgrade,
    icon: <RocketOutlined style={{ color: "var(--ant-primary-color)" }} />,
    width: 1000,
    content: (
      <div
        style={{
          background:
            "no-repeat right bottom / contain url(/assets/images/pricing/background_neuron_analysis.svg)",
        }}
      >
        <p>{introSentence}</p>
        <p>Upgrade Highlights include:</p>
        <ul>
          {featureDescriptions.map((feature) => (
            <li key={feature.slice(0, 10)}>{feature}</li>
          ))}
        </ul>
        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an upgrade will send an email to the webKnossos sales team to upgrade your
          plan. We typically respond within one business day. Billing occurs annually. See our{" "}
          <a href="https://webknossos.org/faq">FAQ</a> for more information.
        </p>
      </div>
    ),
  });
}

export default {
  upgradePricingPlan,
  extendPricingPlan,
  upgradeUserQuota,
  upgradeStorageQuota,
};
