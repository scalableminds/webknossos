import { Button, Radio, Space } from "antd";
import LinkButton from "components/link_button";
import { useInterval } from "libs/react_helpers";
import Toast from "libs/toast";
import UserLocalStorage from "libs/user_local_storage";
import { useEffect, useRef } from "react";
import { useReduxActionListener } from "viewer/model/helpers/listener_helpers";

const TOO_MANY_BUCKETS_TOAST_KEY = "tooManyBucketsWarningModal";

export function TooManyBucketsWarning(): React.ReactNode {
  const notificationAPIRef = useRef(Toast.notificationAPI);
  const neverShowAgainRef = useRef(false);

  useEffect(() => {
    if (Toast.notificationAPI != null) {
      notificationAPIRef.current = Toast.notificationAPI;
    }
  }, []);
  useInterval(() => {
    UserLocalStorage.setItem("suppressBucketWarning", "false");
    console.log("resetting suppressBucketWarning to false every 60s for dev purposes");
  }, 60 * 1000); //TODO_C dev

  const onClose = () => {
    notificationAPIRef.current?.destroy(TOO_MANY_BUCKETS_TOAST_KEY);
    UserLocalStorage.setItem("suppressBucketWarning", neverShowAgainRef.current.toString());
  };
  const toggleNeverShowAgain = () => (neverShowAgainRef.current = !neverShowAgainRef.current);

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

  const showWarningToast = () => {
    const supressTooManyBucketsWarning = UserLocalStorage.getItem("suppressBucketWarning");
    if (notificationAPIRef.current == null) {
      console.log("notificationAPI is null, cannot show toast");
      return null;
    }
    if (supressTooManyBucketsWarning !== "true") {
      console.warn(warningMessage + " For more info, visit: " + linkToDocs);
      Toast.warning(
        <>
          {warningMessage}
          <br />
          {neverShowAgainRadioButton}
        </>,
        { customFooter: footer, key: TOO_MANY_BUCKETS_TOAST_KEY, sticky: true, onClose },
      );
    }
  };
  useReduxActionListener("SHOW_TOO_MANY_BUCKETS_WARNING_TOAST", () => showWarningToast());
  return null;
}
