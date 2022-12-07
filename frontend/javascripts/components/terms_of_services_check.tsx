import {
  acceptTermsOfService,
  getTermsOfService,
  requiresTermsOfServiceAcceptance,
} from "admin/api/terms_of_service";
import { Modal, Spin } from "antd";
import { AsyncButton } from "components/async_clickables";
import { useFetch } from "libs/react_helpers";
import type { OxalisState } from "oxalis/store";
import React, { useState } from "react";
import { useSelector } from "react-redux";

export function CheckTermsOfServices() {
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
  const onAccept = async (version: number) => {
    await acceptTermsOfService(version);
    setRecheckCounter((val) => val + 1);
  };

  if (!acceptanceInfo || !activeUser || !acceptanceInfo.acceptanceNeeded) {
    return null;
  }

  if (activeUser.isOrganizationOwner) {
    return <AcceptTermsOfServiceModal onAccept={onAccept} />;
  } else {
    return <TermsOfServiceAcceptanceMissingModal />;
  }
}

function AcceptTermsOfServiceModal({ onAccept }: { onAccept: (version: number) => Promise<void> }) {
  const terms = useFetch(getTermsOfService, null, []);

  return (
    <Modal
      open
      title="Terms of Services"
      closable={false}
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
      <p>Please accept the following terms of services to continue using webKnossos:</p>

      <div style={{ maxHeight: "66vh", overflow: "auto" }}>
        {terms == null ? (
          <Spin spinning />
        ) : (
          <iframe
            style={{ width: 800, height: 800, border: "none" }}
            src={"https://wikipedia.org" || terms.url}
          />
        )}
      </div>
    </Modal>
  );
}

function TermsOfServiceAcceptanceMissingModal() {
  return (
    <Modal open footer={null} closable={false} maskClosable={false}>
      Please ask the organization owner to accept the terms of services.
    </Modal>
  );
}
