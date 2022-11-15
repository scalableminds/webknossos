import React, { useRef } from "react";
import { Divider, InputNumber, Modal } from "antd";
import moment from "moment";
import {
  DatabaseOutlined,
  FieldTimeOutlined,
  RocketOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import { APIOrganization } from "types/api_flow_types";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import {
  sendExtendPricingPlanEmail,
  sendUpgradePricingPlanEmail,
  sendUpgradePricingPlanStorageEmail,
  sendUpgradePricingPlanUserEmail,
} from "admin/admin_rest_api";
import { powerPlanFeatures, teamPlanFeatures } from "./pricing_plan_utils";
import { PricingPlanEnum } from "./organization_edit_view";
import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";

function extendPricingPlan(organization: APIOrganization) {
  const extendedDate = moment(organization.paidUntil).add(1, "year");

  Modal.confirm({
    title: "Extend Current Plan",
    okText: "Request Extension",
    onOk: sendExtendPricingPlanEmail,
    icon: <FieldTimeOutlined style={{ color: "var(--ant-primary-color)" }} />,
    width: 1000,
    content: (
      <div
        style={{
          background:
            "right -150px / 50% no-repeat url(/assets/images/pricing/background_neurons.jpeg)",
        }}
      >
        <p style={{ marginRight: "30%" }}>
          Extend your plan now for uninterrupted access to webKnossos. Expired plans will be
          downgraded to the Free plan and you might lose access to some webKnossos features and see
          restrictions on the number of permitted user accounts and your included storage space
          quota.
        </p>
        <p>
          Your current plan is paid until:{" "}
          {formatDateInLocalTimeZone(organization.paidUntil, "YYYY-MM-DD")}
        </p>
        <p>Buy extension until: {extendedDate.format("YYYY-MM-DD")}</p>
        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an extension will send an email to the webKnossos sales team to extend your
          current plan. We typically respond within one business day. webKnossos plans are billed
          annually. See our <a href="https://webknossos.org/faq">FAQ</a> for more information.
        </p>
      </div>
    ),
  });
}

function upgradeUserQuota() {
  renderIndependently((destroyCallback) => <UpgradeUserQuotaModal destroy={destroyCallback} />);
}

function UpgradeUserQuotaModal({ destroy }: { destroy: () => void }) {
  const userInputRef = useRef<HTMLInputElement | null>(null);

  function handleUserUpgrade() {
    if (userInputRef.current) {
      const requestedUsers = parseInt(userInputRef.current.value);
      sendUpgradePricingPlanUserEmail(requestedUsers);
      Toast.success("An email with your request has been send to the webKnossos team.");
    }

    destroy();
  }

  return (
    <Modal
      title={
        <>
          <UserAddOutlined style={{ color: "var(--ant-primary-color)" }} /> Upgrade User Quota
        </>
      }
      okText={"Request More Users"}
      onOk={handleUserUpgrade}
      onCancel={destroy}
      width={800}
      visible
    >
      <div
        style={{
          background:
            "right -40px / 35% no-repeat url(/assets/images/pricing/background_users.jpeg)",
        }}
      >
        <p style={{ marginRight: "30%" }}>
          You can increase the number of users allowed to join your organization by either buying
          single user upgrades or by upgrading your webKnossos plan to “Power” for unlimited users.
        </p>
        <div>Add additional user accounts:</div>
        <div>
          <InputNumber min={1} defaultValue={1} ref={userInputRef} />
        </div>

        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an upgrade to your organization&apos;s user quota will send an email to the
          webKnossos sales team. We typically respond within one business day. See our{" "}
          <a href="https://webknossos.org/faq">FAQ</a> for more information.
        </p>
      </div>
    </Modal>
  );
}

function upgradeStorageQuota() {
  renderIndependently((destroyCallback) => <UpgradeStorageQuotaModal destroy={destroyCallback} />);
}
function UpgradeStorageQuotaModal({ destroy }: { destroy: () => void }) {
  const storageInputRef = useRef<HTMLInputElement | null>(null);

  const handleStorageUpgrade = () => {
    if (storageInputRef.current) {
      const requestedStorage = parseInt(storageInputRef.current.value);
      sendUpgradePricingPlanStorageEmail(requestedStorage);
      Toast.success("An email with your request has been send to the webKnossos team.");
    }

    destroy();
  };

  return (
    <Modal
      title={
        <>
          <DatabaseOutlined style={{ color: "var(--ant-primary-color)" }} /> Upgrade Storage Space
        </>
      }
      okText={"Request More Storage Space"}
      onOk={handleStorageUpgrade}
      onCancel={destroy}
      width={800}
      visible
    >
      <div
        style={{
          background:
            "right -30px / 35% no-repeat url(/assets/images/pricing/background_evaluation.jpeg)",
        }}
      >
        <p style={{ marginRight: "30%" }}>
          You can increase your storage limit for your organization by either buying additional
          storage upgrades or by upgrading your webKnossos plan to “Power” for custom dataset
          hosting solution, e.g. streaming data from your storage server / the cloud.
        </p>
        <div>Add additional storage (in Terabyte):</div>
        <div>
          <InputNumber min={1} defaultValue={1} ref={storageInputRef} />
        </div>
        <Divider style={{ marginTop: 40 }} />
        <p style={{ color: "#aaa", fontSize: 12 }}>
          Requesting an upgrade to your organization&apos;s storage quota will send an email to the
          webKnossos sales team. We typically respond within one business day. See our{" "}
          <a href="https://webknossos.org/faq">FAQ</a> for more information.
        </p>
      </div>
    </Modal>
  );
}

function upgradePricingPlan(organization: APIOrganization) {
  const introSentence =
    "Upgrading your webKnossos plan will unlock more advanced features and increase your user and storage quotas.";

  let title = `Upgrade to ${PricingPlanEnum.Team} Plan`;
  let featureDescriptions = teamPlanFeatures;
  let callback = () => sendUpgradePricingPlanEmail(PricingPlanEnum.Team);

  if (
    organization.pricingPlan === PricingPlanEnum.Team ||
    organization.pricingPlan === PricingPlanEnum.TeamTrial
  ) {
    title = `Upgrade to ${PricingPlanEnum.Power} Plan`;
    featureDescriptions = powerPlanFeatures;
    callback = () => sendUpgradePricingPlanEmail(PricingPlanEnum.Power);
  }

  Modal.confirm({
    title,
    okText: "Request Upgrade",
    onOk: callback,
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
