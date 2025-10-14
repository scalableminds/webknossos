import { Button, Checkbox, type CheckboxChangeEvent, Space } from "antd";
import { useInterval } from "libs/react_helpers";
import Toast from "libs/toast";
import UserLocalStorage from "libs/user_local_storage";
import { useCallback, useEffect, useRef } from "react";
import { useReduxActionListener } from "viewer/model/helpers/listener_helpers";

const TOO_MANY_BUCKETS_TOAST_KEY = "tooManyBucketsWarningModal";

export function TooManyBucketsWarning(): React.ReactNode {
  const notificationAPIRef = useRef(Toast.notificationAPI);
  const neverShowAgainRef = useRef(false);
  const dontShowAgainInThisSessionRef = useRef(false);

  useEffect(() => {
    if (Toast.notificationAPI != null) {
      notificationAPIRef.current = Toast.notificationAPI;
    }
  }, []);
  useInterval(() => {
    UserLocalStorage.setItem("suppressBucketWarning", "false");
    console.log("resetting suppressBucketWarning to false every 120s for dev purposes");
  }, 120 * 1000); //TODO_C dev

  const onClose = useCallback(() => {
    notificationAPIRef.current?.destroy(TOO_MANY_BUCKETS_TOAST_KEY);
    dontShowAgainInThisSessionRef.current = true;
    UserLocalStorage.setItem("suppressBucketWarning", neverShowAgainRef.current.toString());
  }, []);
  const handleCheckboxChange = (event: CheckboxChangeEvent) => {
    neverShowAgainRef.current = event.target.checked;
  };

  const warningMessage =
    "You are annotating a large area with fine magnifications. This can significantly slow down WEBKNOSSOS. Consider creating an annotation or annotation layer with restricted magnifications.";
  const linkToDocs =
    "https://docs.webknossos.org/volume_annotation/import_export.html#restricting-magnifications";
  const neverShowAgainCheckbox = (
    <Checkbox onChange={handleCheckboxChange} style={{ marginTop: "8px", marginBottom: "5px" }}>
      Never show this again
    </Checkbox>
  );
  const closeButton = (
    <Button
      onClick={() => {
        onClose();
      }}
    >
      Close
    </Button>
  );
  const linkToDocsButton = (
    <Button href={linkToDocs} target="_blank" rel="noopener noreferrer" type="primary">
      Learn how
    </Button>
  );
  const footer = (
    <div>
      <Space>
        {linkToDocsButton}
        {closeButton}
      </Space>
    </div>
  );

  const showWarningToast = () => {
    const supressTooManyBucketsWarning = UserLocalStorage.getItem("suppressBucketWarning");
    if (notificationAPIRef.current == null) {
      return null;
    }
    if (supressTooManyBucketsWarning !== "true" && dontShowAgainInThisSessionRef.current !== true) {
      console.warn(warningMessage + " For more info, visit: " + linkToDocs);
      Toast.warning(
        <>
          {warningMessage}
          <br />
          {neverShowAgainCheckbox}
        </>,
        {
          customFooter: footer,
          key: TOO_MANY_BUCKETS_TOAST_KEY,
          sticky: true,
          onClose,
          className: "many-buckets-warning",
        },
      );
    } else {
      console.log("suppressing warning toast");
    }
  };
  useReduxActionListener("SHOW_TOO_MANY_BUCKETS_WARNING_TOAST", () => showWarningToast());
  return null;
}
