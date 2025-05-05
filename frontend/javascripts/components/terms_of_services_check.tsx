import { DownOutlined } from "@ant-design/icons";
import {
  type AcceptanceInfo,
  acceptTermsOfService,
  getTermsOfService,
  requiresTermsOfServiceAcceptance,
} from "admin/api/terms_of_service";
import { getUsersOrganizations } from "admin/rest_api";
import { Dropdown, type MenuProps, Modal, Space, Spin } from "antd";
import { AsyncButton } from "components/async_clickables";
import dayjs from "dayjs";
import { useFetch } from "libs/react_helpers";
import UserLocalStorage from "libs/user_local_storage";
import _ from "lodash";
import { switchTo } from "navbar";
import { useWkSelector } from "oxalis/store";
import type React from "react";
import { useEffect, useState } from "react";
import type { APIUser } from "types/api_types";
import { formatDateInLocalTimeZone } from "./formatted_date";

const SNOOZE_DURATION_IN_DAYS = 3;
const LAST_TERMS_OF_SERVICE_WARNING_KEY = "lastTermsOfServiceWarning";

export function CheckTermsOfServices() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const closeModal = () => {
    UserLocalStorage.setItem(LAST_TERMS_OF_SERVICE_WARNING_KEY, String(Date.now()));
    setIsModalOpen(false);
  };
  const activeUser = useWkSelector((state) => state.activeUser);
  const [recheckCounter, setRecheckCounter] = useState(0);
  const acceptanceInfo = useFetch(
    async () => {
      if (activeUser == null) {
        return null;
      }
      return await requiresTermsOfServiceAcceptance();
    },
    null,
    [activeUser, recheckCounter],
  );

  useEffect(() => {
    // Show ToS modal when the acceptance is needed and it wasn't snoozed
    // (unless the deadline is exceeded).
    if (!acceptanceInfo || !acceptanceInfo.acceptanceNeeded) {
      return;
    }
    if (acceptanceInfo.acceptanceNeeded && acceptanceInfo.acceptanceDeadlinePassed) {
      setIsModalOpen(true);
      return;
    }

    const lastWarningString = UserLocalStorage.getItem(LAST_TERMS_OF_SERVICE_WARNING_KEY);
    const lastWarning = dayjs(lastWarningString ? Number.parseInt(lastWarningString) : 0);
    const isLastWarningOld = dayjs().diff(lastWarning, "days") > SNOOZE_DURATION_IN_DAYS;
    setIsModalOpen(isLastWarningOld);
  }, [acceptanceInfo]);
  const onAccept = async (version: number) => {
    await acceptTermsOfService(version);
    setRecheckCounter((val) => val + 1);
  };

  if (!acceptanceInfo || !activeUser || !acceptanceInfo.acceptanceNeeded) {
    return null;
  }

  if (activeUser.isOrganizationOwner) {
    return (
      <AcceptTermsOfServiceModal
        acceptanceInfo={acceptanceInfo}
        onAccept={onAccept}
        isModalOpen={isModalOpen}
        closeModal={closeModal}
        activeUser={activeUser}
      />
    );
  } else {
    return (
      <TermsOfServiceAcceptanceMissingModal
        acceptanceInfo={acceptanceInfo}
        isModalOpen={isModalOpen}
        closeModal={closeModal}
        activeUser={activeUser}
      />
    );
  }
}

function OrganizationSwitchMenu({
  activeUser,
  style,
}: {
  activeUser: APIUser;
  style?: React.CSSProperties;
}) {
  const { organization: organizationId } = activeUser;
  const usersOrganizations = useFetch(getUsersOrganizations, [], []);
  const switchableOrganizations = usersOrganizations.filter((org) => org.id !== organizationId);
  const isMultiMember = switchableOrganizations.length > 0;

  if (!isMultiMember) {
    return null;
  }

  const items: MenuProps["items"] = switchableOrganizations.map((org) => ({
    key: org.id,
    onClick: () => switchTo(org),
    label: org.name || org.id,
  }));

  return (
    <Dropdown menu={{ items }} overlayStyle={{ maxHeight: "60vh", overflow: "auto" }}>
      <a onClick={(e) => e.preventDefault()}>
        <Space style={style}>
          Switch Organization
          <DownOutlined />
        </Space>
      </a>
    </Dropdown>
  );
}

function AcceptTermsOfServiceModal({
  onAccept,
  acceptanceInfo,
  isModalOpen,
  closeModal,
  activeUser,
}: {
  onAccept: (version: number) => Promise<void>;
  acceptanceInfo: AcceptanceInfo;
  isModalOpen: boolean;
  closeModal: () => void;
  activeUser: APIUser;
}) {
  const terms = useFetch(getTermsOfService, null, []);

  const deadlineExplanation = getDeadlineExplanation(acceptanceInfo);

  return (
    <Modal
      open={isModalOpen}
      title="Terms of Services"
      closable={!acceptanceInfo.acceptanceDeadlinePassed}
      onCancel={acceptanceInfo.acceptanceDeadlinePassed ? _.noop : closeModal}
      width={850}
      maskClosable={false}
      footer={[
        <OrganizationSwitchMenu
          activeUser={activeUser}
          style={{ marginRight: 12 }}
          key={"switch-org"}
        />,
        <AsyncButton
          key={"accept-button"}
          type="primary"
          loading={terms?.url == null}
          onClick={async () => (terms != null ? await onAccept(terms.version) : null)}
        >
          Accept
        </AsyncButton>,
      ]}
    >
      <p>
        <b>
          Please accept the following terms of services to continue using WEBKNOSSOS.{" "}
          {deadlineExplanation}
        </b>
      </p>

      {terms == null ? (
        <Spin spinning />
      ) : (
        <iframe style={{ width: 800, height: "55vh", border: "none" }} src={terms.url} />
      )}
    </Modal>
  );
}

function getDeadlineExplanation(acceptanceInfo: AcceptanceInfo) {
  return acceptanceInfo.acceptanceDeadlinePassed
    ? null
    : `If the terms are not accepted until ${formatDateInLocalTimeZone(
        acceptanceInfo.acceptanceDeadline,
      )}, WEBKNOSSOS cannot be used until the terms are accepted.`;
}

function TermsOfServiceAcceptanceMissingModal({
  acceptanceInfo,
  isModalOpen,
  closeModal,
  activeUser,
}: {
  acceptanceInfo: AcceptanceInfo;
  isModalOpen: boolean;
  closeModal: () => void;
  activeUser: APIUser;
}) {
  const deadlineExplanation = getDeadlineExplanation(acceptanceInfo);
  return (
    <Modal
      open={isModalOpen}
      closable={!acceptanceInfo.acceptanceDeadlinePassed}
      onCancel={closeModal}
      footer={[<OrganizationSwitchMenu activeUser={activeUser} key={"switch-org"} />]}
      maskClosable={false}
    >
      Please ask the organization owner to accept the terms of services. {deadlineExplanation}
    </Modal>
  );
}
