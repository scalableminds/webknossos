import React from "react";
import { Divider, Modal } from "antd";
import {
  DatabaseOutlined,
  FieldTimeOutlined,
  RocketOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { teamPlanFeatures } from "./pricing_plan_utils";
import _ from "lodash";

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

function extendPricingPlan() {
  Modal.confirm({
    title: "Extend Current Plan",
    okText: "Request Extension",
    onOk: handleExtendPlan,
    icon: <FieldTimeOutlined style={{ color: "var(--ant-primary-color)" }} />,
    content: (
      <div>
        <p>TODO</p>
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
    content: (
      <div>
        <p>TODO</p>
        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an upgrade to your organization's user quota will send an email to the
          webKnossos sales team to upgrade your current plan. We typically respond within one
          business day. See our <a href="https://webknossos.org/faq">FAQ</a> for more information.
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
    content: (
      <div>
        <p>TODO</p>
        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an upgrade to your organization's storage quota will send an email to the
          webKnossos sales team to upgrade your current plan. We typically respond within one
          business day. See our <a href="https://webknossos.org/faq">FAQ</a> for more information.
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
    title: title,
    okText: "Request Upgrade",
    onOk: handlePlanUpgrade,
    icon: <RocketOutlined style={{ color: "var(--ant-primary-color)" }} />,
    width: 1000,
    content: (
      <div>
        <p>{introSentence}</p>
        <p>
          Upgrade Highlights include:
          <ul>
            {featureDescriptions.map((feature) => (
              <li key={feature.slice(0, 10)}>{feature}</li>
            ))}
          </ul>
        </p>
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
