import {
  DatabaseOutlined,
  FieldTimeOutlined,
  RocketOutlined,
  UserAddOutlined,
} from "@ant-design/icons";
import {
  sendExtendPricingPlanEmail,
  sendOrderCreditsEmail,
  sendUpgradePricingPlanEmail,
  sendUpgradePricingPlanStorageEmail,
  sendUpgradePricingPlanUserEmail,
} from "admin/rest_api";
import { Button, Col, Divider, InputNumber, Modal, Row } from "antd";
import { formatDateInLocalTimeZone } from "components/formatted_date";
import dayjs from "dayjs";
import features from "features";
import { formatCurrency } from "libs/format_utils";

import renderIndependently from "libs/render_independently";
import Toast from "libs/toast";
import messages from "messages";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { APIOrganization } from "types/api_types";
import { PowerPlanUpgradeCard, TeamPlanUpgradeCard } from "./organization_cards";
import { powerPlanFeatures, teamPlanFeatures } from "./pricing_plan_utils";
import { PricingPlanEnum } from "./pricing_plan_utils";

const ModalInformationFooter = (
  <>
    <Divider style={{ marginTop: 40 }} />
    <p style={{ color: "#aaa", fontSize: 12 }}>
      Requesting an upgrade to your organization&apos;s WEBKNOSSOS plan will send an email to the
      WEBKNOSSOS sales team. We typically respond within one business day. See our{" "}
      <a href="https://webknossos.org/faq">FAQ</a> for more information.
    </p>
  </>
);

export function extendPricingPlan(organization: APIOrganization) {
  const extendedDate = dayjs(organization.paidUntil).add(1, "year");

  Modal.confirm({
    title: "Extend Current Plan",
    okText: "Request an Email Quote",
    onOk: () => {
      sendExtendPricingPlanEmail();
      Toast.success(messages["organization.plan.upgrage_request_sent"]);
    },
    icon: <FieldTimeOutlined style={{ color: "var(--ant-color-primary)" }} />,
    width: 1000,
    content: (
      <div>
        <p style={{ marginRight: "30%" }}>
          Extend your plan now for uninterrupted access to WEBKNOSSOS.
        </p>
        <p style={{ marginRight: "30%" }}>
          Expired plans will be downgraded to the Basic plan and you might lose access to some
          WEBKNOSSOS features and see restrictions on the number of permitted user accounts and your
          included storage space quota.
        </p>
        <p>
          Your current plan is paid until:{" "}
          {formatDateInLocalTimeZone(organization.paidUntil, "YYYY-MM-DD")}
        </p>
        <p>Buy extension until: {extendedDate.format("YYYY-MM-DD")}</p>
        {ModalInformationFooter}
      </div>
    ),
  });
}

export function upgradeUserQuota() {
  renderIndependently((destroyCallback) => <UpgradeUserQuotaModal destroy={destroyCallback} />);
}

function UpgradeUserQuotaModal({ destroy }: { destroy: () => void }) {
  const userInputRef = useRef<HTMLInputElement | null>(null);

  const handleUserUpgrade = async () => {
    if (userInputRef.current) {
      const requestedUsers = Number.parseInt(userInputRef.current.value);
      await sendUpgradePricingPlanUserEmail(requestedUsers);
      Toast.success(messages["organization.plan.upgrage_request_sent"]);
    }

    destroy();
  };

  return (
    <Modal
      title={
        <>
          <UserAddOutlined style={{ color: "var(--ant-color-primary)" }} /> Upgrade User Quota
        </>
      }
      okText={"Buy more Users"}
      onOk={handleUserUpgrade}
      onCancel={destroy}
      width={800}
      open
    >
      <div className="drawing-upgrade-users">
        <p style={{ marginRight: "30%" }}>
          You can increase the number of users allowed to join your organization by either buying
          single user upgrades or by upgrading your WEBKNOSSOS plan to “Power” for unlimited users.
        </p>
        <div>Add additional user accounts:</div>
        <div>
          <InputNumber min={1} defaultValue={1} ref={userInputRef} size="large" />
        </div>
        {ModalInformationFooter}
      </div>
    </Modal>
  );
}

export function upgradeStorageQuota() {
  renderIndependently((destroyCallback) => <UpgradeStorageQuotaModal destroy={destroyCallback} />);
}
function UpgradeStorageQuotaModal({ destroy }: { destroy: () => void }) {
  const storageInputRef = useRef<HTMLInputElement | null>(null);

  const handleStorageUpgrade = async () => {
    if (storageInputRef.current) {
      const requestedStorage = Number.parseInt(storageInputRef.current.value);
      await sendUpgradePricingPlanStorageEmail(requestedStorage);
      Toast.success(messages["organization.plan.upgrage_request_sent"]);
    }

    destroy();
  };

  return (
    <Modal
      title={
        <>
          <DatabaseOutlined style={{ color: "var(--ant-color-primary)" }} /> Upgrade Storage Space
        </>
      }
      okText={"Buy more Storage Space"}
      onOk={handleStorageUpgrade}
      onCancel={destroy}
      width={800}
      open
    >
      <div className="drawing-upgrade-storage">
        <p style={{ marginRight: "30%" }}>
          You can increase your storage limit for your organization by either buying additional
          storage upgrades or by upgrading your WEBKNOSSOS plan to “Power” for custom dataset
          hosting solution, e.g. streaming data from your storage server / the cloud.
        </p>
        <div>Add additional storage (in Terabyte):</div>
        <div>
          <InputNumber min={1} defaultValue={1} ref={storageInputRef} />
        </div>
        {ModalInformationFooter}
      </div>
    </Modal>
  );
}

function upgradePricingPlan(
  organization: APIOrganization,
  targetPlan?: PricingPlanEnum | "TeamAndPower",
) {
  let target = targetPlan;

  if (targetPlan === undefined) {
    switch (organization.pricingPlan) {
      case PricingPlanEnum.Basic: {
        target = "TeamAndPower";
        break;
      }
      case PricingPlanEnum.Team:
      case PricingPlanEnum.TeamTrial: {
        target = PricingPlanEnum.Power;
        break;
      }
      case PricingPlanEnum.Custom:
      default:
        return;
    }
  }

  let title = `Upgrade to ${PricingPlanEnum.Team} Plan`;
  let okButtonCallback: (() => void) | undefined = () => {
    sendUpgradePricingPlanEmail(PricingPlanEnum.Team);
    Toast.success(messages["organization.plan.upgrage_request_sent"]);
  };
  let modalBody = (
    <>
      <p>Upgrade Highlights include:</p>
      <ul>
        {teamPlanFeatures.map((feature) => (
          <li key={feature.slice(0, 10)}>{feature}</li>
        ))}
      </ul>
    </>
  );

  if (target === PricingPlanEnum.Power) {
    title = `Upgrade to ${PricingPlanEnum.Power} Plan`;
    okButtonCallback = () => {
      sendUpgradePricingPlanEmail(PricingPlanEnum.Power);
      Toast.success(messages["organization.plan.upgrage_request_sent"]);
    };
    modalBody = (
      <>
        <p>Upgrade Highlights include:</p>
        <ul>
          {powerPlanFeatures.map((feature) => (
            <li key={feature.slice(0, 10)}>{feature}</li>
          ))}
        </ul>
      </>
    );
  }

  renderIndependently((destroyCallback) => {
    if (target === "TeamAndPower") {
      title = "Upgrade to unlock more features";
      okButtonCallback = undefined;
      modalBody = (
        <Row gutter={16}>
          <Col span={12}>
            <TeamPlanUpgradeCard
              teamUpgradeCallback={async () => {
                await sendUpgradePricingPlanEmail(PricingPlanEnum.Team);
                Toast.success(messages["organization.plan.upgrage_request_sent"]);
                destroyCallback();
              }}
            />
          </Col>
          <Col span={12}>
            <PowerPlanUpgradeCard
              powerUpgradeCallback={async () => {
                await sendUpgradePricingPlanEmail(PricingPlanEnum.Power);
                Toast.success(messages["organization.plan.upgrage_request_sent"]);
                destroyCallback();
              }}
            />
          </Col>
        </Row>
      );
    }

    return (
      <UpgradePricingPlanModal
        title={title}
        modalBody={modalBody}
        okButtonCallback={okButtonCallback}
        destroy={destroyCallback}
      />
    );
  });
}

export function UpgradePricingPlanModal({
  title,
  modalBody,
  destroy,
  okButtonCallback,
}: {
  title: string;
  modalBody: React.ReactElement;
  destroy: () => void;
  okButtonCallback: (() => void) | undefined;
}) {
  const introSentence =
    "Upgrading your WEBKNOSSOS plan will unlock more advanced features and increase your user and storage quotas.";

  return (
    <Modal
      open
      title={
        <>
          <RocketOutlined style={{ color: "var(--ant-color-primary)" }} /> {title}
        </>
      }
      width={800}
      onCancel={destroy}
      footer={
        <>
          <Button onClick={destroy}>Cancel</Button>
          {okButtonCallback ? (
            <Button
              onClick={() => {
                okButtonCallback();
                destroy();
              }}
              type="primary"
            >
              Request Upgrade
            </Button>
          ) : null}
        </>
      }
      zIndex={10000} // overlay everything
    >
      <div>
        <p>{introSentence}</p>
        {modalBody}
        {ModalInformationFooter}
      </div>
    </Modal>
  );
}

export function orderWebknossosCredits() {
  renderIndependently((destroyCallback) => (
    <OrderWebknossosCreditsModal destroy={destroyCallback} />
  ));
}

function OrderWebknossosCreditsModal({ destroy }: { destroy: () => void }) {
  const userInputRef = useRef<HTMLInputElement | null>(null);
  const defaultCostPerCreditInEuro = formatCurrency(features().costPerCreditInEuro, "€");
  const defaultCostPerCreditInDollar = formatCurrency(features().costPerCreditInDollar, "$");
  const [creditCostAsString, setCreditCostsAsString] = useState<string>(
    `${defaultCostPerCreditInEuro}€/${defaultCostPerCreditInDollar}$`,
  );
  const [creditAmount, setCreditAmount] = useState<number | null>(1);
  useEffect(() => {
    if (creditAmount == null) {
      return;
    }
    const totalCostInEuro = creditAmount * features().costPerCreditInEuro;
    const totalCostInDollar = creditAmount * features().costPerCreditInDollar;
    setCreditCostsAsString(`${totalCostInEuro}€/${totalCostInDollar}$`);
  }, [creditAmount]);

  const handleOrderCredits = async () => {
    if (userInputRef.current) {
      const requestedUsers = Number.parseInt(userInputRef.current.value);
      try {
        await sendOrderCreditsEmail(requestedUsers);
        Toast.success(messages["organization.credit_request_sent"]);
      } catch (e) {
        Toast.error(`Could not request credits: ${e}`);
        console.log(e);
      }
    }

    destroy();
  };

  return (
    <Modal
      title="Buy more WEBKNOSSOS Credits"
      okText={`Buy more WEBKNOSSOS Credits for ${creditCostAsString}`}
      onOk={handleOrderCredits}
      onCancel={destroy}
      width={800}
      open
    >
      <div className="drawing-upgrade-users">
        <p style={{ marginRight: "5%" }}>
          You can buy new WEBKNOSSOS credits to pay for premium jobs and services. Each credit costs{" "}
          {defaultCostPerCreditInEuro} or {defaultCostPerCreditInDollar}.
        </p>
        <div>Amount of credits to order:</div>
        <div>
          <InputNumber
            min={1}
            defaultValue={1}
            step={1}
            ref={userInputRef}
            size="large"
            onChange={setCreditAmount}
            value={creditAmount}
          />
        </div>
        Total resulting cost: {creditCostAsString}
        <>
          <Divider style={{ marginTop: 40 }} />
          <p style={{ color: "#aaa", fontSize: 12 }}>
            Ordering WEBKNOSSOS credits for your organization will send an email to the WEBKNOSSOS
            sales team. We typically respond within one business day to discuss payment options and
            purchasing requirements. See our{" "}
            <a href="https://webknossos.org/faq" target="_blank" rel="noreferrer">
              FAQ
            </a>{" "}
            for more information.
          </p>
        </>
      </div>
    </Modal>
  );
}

export default {
  upgradePricingPlan,
  extendPricingPlan,
  upgradeUserQuota,
  upgradeStorageQuota,
  orderWebknossosCredits,
};
