import {
  AcceptanceInfo,
  acceptTermsOfService,
  getTermsOfService,
  requiresTermsOfServiceAcceptance,
} from "admin/api/terms_of_service";
import { Modal, Spin } from "antd";
import { AsyncButton } from "components/async_clickables";
import { useFetch } from "libs/react_helpers";
import UserLocalStorage from "libs/user_local_storage";
import moment from "moment";
import type { OxalisState } from "oxalis/store";
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { formatDateInLocalTimeZone } from "./formatted_date";

const SNOOZE_DURATION_IN_DAYS = 3;
const LAST_TERMS_OF_SERVICE_WARNING_KEY = "lastTermsOfServiceWarning";

export function CheckTermsOfServices() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const closeModal = () => {
    UserLocalStorage.setItem(LAST_TERMS_OF_SERVICE_WARNING_KEY, String(Date.now()));
    setIsModalOpen(false);
  };
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
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
    const lastWarning = moment(lastWarningString ? parseInt(lastWarningString) : 0);
    const isLastWarningOld = moment().diff(lastWarning, "days") > SNOOZE_DURATION_IN_DAYS;
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
      />
    );
  } else {
    return (
      <TermsOfServiceAcceptanceMissingModal
        acceptanceInfo={acceptanceInfo}
        isModalOpen={isModalOpen}
        closeModal={closeModal}
      />
    );
  }
}

function AcceptTermsOfServiceModal({
  onAccept,
  acceptanceInfo,
  isModalOpen,
  closeModal,
}: {
  onAccept: (version: number) => Promise<void>;
  acceptanceInfo: AcceptanceInfo;
  isModalOpen: boolean;
  closeModal: () => void;
}) {
  const terms = useFetch(getTermsOfService, null, []);

  const deadlineExplanation = getDeadlineExplanation(acceptanceInfo);

  return (
    <Modal
      open={isModalOpen}
      title="Terms of Services"
      closable={!acceptanceInfo.acceptanceDeadlinePassed}
      onCancel={closeModal}
      width={850}
      maskClosable={false}
      footer={[
        <AsyncButton
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
}: {
  acceptanceInfo: AcceptanceInfo;
  isModalOpen: boolean;
  closeModal: () => void;
}) {
  const deadlineExplanation = getDeadlineExplanation(acceptanceInfo);
  return (
    <Modal
      open={isModalOpen}
      closable={!acceptanceInfo.acceptanceDeadlinePassed}
      onCancel={closeModal}
      footer={null}
      maskClosable={false}
    >
      Please ask the organization owner to accept the terms of services. {deadlineExplanation}
    </Modal>
  );
}
