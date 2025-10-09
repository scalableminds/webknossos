import { Button, Modal, Radio, Space } from "antd";
import LinkButton from "components/link_button";
import { useInterval } from "libs/react_helpers";
import UserLocalStorage from "libs/user_local_storage";
import { useState } from "react";
import { useReduxActionListener } from "viewer/model/helpers/listener_helpers";

export function TooManyBucketsWarningModal() {
  useInterval(() => {
    UserLocalStorage.setItem("suppressBucketWarning", "false");
    console.log("resetting suppressBucketWarning to false");
  }, 60 * 1000); //TODO_C dev
  const supressTooManyBucketsWarning = UserLocalStorage.getItem("suppressBucketWarning");
  console.log("getting suppressBucketWarning", supressTooManyBucketsWarning);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [neverShowAgain, setNeverShowAgain] = useState(false);
  useReduxActionListener("SHOW_TOO_MANY_BUCKETS_WARNING_TOAST", () => setIsModalOpen(true));
  const onClose = () => {
    setIsModalOpen(false);
    console.log("set suppressBucketWarning", neverShowAgain.toString());
    UserLocalStorage.setItem("suppressBucketWarning", neverShowAgain.toString());
  };
  const toggleNeverShowAgain = () => setNeverShowAgain(!neverShowAgain);

  const warningMessage =
    "You are annotating a large area which puts a high load on the server. Consider creating an annotation or annotation layer with restricted volume magnifications.";
  const linkToDocs =
    "https://docs.webknossos.org/volume_annotation/import_export.html#restricting-magnifications";
  const neverShowAgainRadioButton = (
    <Radio onClick={toggleNeverShowAgain}>Never show this again</Radio>
  );
  const closeButton = (
    <Button
      onClick={() => {
        onClose();
      }}
      type="primary"
    >
      Close
    </Button>
  );
  const linkToDocsButton = (
    <LinkButton href={linkToDocs} target="_blank" rel="noopener noreferrer">
      See docs
    </LinkButton>
  );
  const footer = (
    <Space>
      {linkToDocsButton}
      {closeButton}
    </Space>
  );
  if (supressTooManyBucketsWarning !== "true" && isModalOpen) {
    console.warn(warningMessage + " For more info, visit: " + linkToDocs);
    return (
      <Modal footer={footer} open={isModalOpen} onCancel={onClose} title="Warning" mask={false}>
        <>
          {warningMessage}
          <br />
          {neverShowAgainRadioButton}.
        </>
      </Modal>
    );
  }
}
