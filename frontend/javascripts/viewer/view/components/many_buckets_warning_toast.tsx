import { Button, Radio, Space } from "antd";
import LinkButton from "components/link_button";
import Toast from "libs/toast";
import UserLocalStorage from "libs/user_local_storage";
import { useState } from "react";

export function TooManyBucketsWarningToast() {
  const supressTooManyBucketsWarning = UserLocalStorage.getItem("suppressBucketWarning");
  console.log("getting suppressBucketWarning", supressTooManyBucketsWarning);
  const [isToastClosed, setIsToastClosed] = useState(false);
  const [neverShowAgain, setNeverShowAgain] = useState(false);
  const onClose = () => {
    setIsToastClosed(!isToastClosed);
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
        setIsToastClosed(true);
        console.log("set suppressBucketWarning", neverShowAgain.toString());
        UserLocalStorage.setItem("suppressBucketWarning", neverShowAgain.toString());
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
  if (supressTooManyBucketsWarning !== "true") {
    Toast.warning(
      <>
        {warningMessage}
        <br />
        {neverShowAgainRadioButton}.
      </>,
      { sticky: true, customFooter: footer, onClose },
    );
    console.warn(warningMessage + " For more info, visit: " + linkToDocs);
  }
}
