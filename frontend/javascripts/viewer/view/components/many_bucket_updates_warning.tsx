import { Button, Checkbox, type CheckboxChangeEvent, Space } from "antd";
import Toast from "libs/toast";
import UserLocalStorage from "libs/user_local_storage";
import { takeEvery } from "typed-redux-saga";
import type { Saga } from "viewer/model/sagas/effect-generators";

const TOO_MANY_BUCKETS_TOAST_KEY = "manyBucketUpdatesWarningToast";
const WARNING_SUPPRESSION_USER_STORAGE_KEY = "suppressBucketWarning";

function* manyBucketUpdatesWarning(): Saga<void> {
  let dontShowAgainInThisSessionRef = false;
  const setDontShowAgainInThisSession = (value: boolean) => {
    dontShowAgainInThisSessionRef = value;
  };
  yield takeEvery(
    "SHOW_MANY_BUCKET_UPDATES_WARNING",
    showWarningToast,
    dontShowAgainInThisSessionRef,
    setDontShowAgainInThisSession,
  );
}

function* showWarningToast(
  dontShowAgainInThisSession: boolean,
  setDontShowAgainInThisSession: (value: boolean) => void,
): Saga<void> {
  let neverShowAgainRef = false;

  setInterval(() => {
    UserLocalStorage.setItem("suppressBucketWarning", "false");
    console.log("resetting suppressBucketWarning to false every 120s for dev purposes");
  }, 120 * 1000);
  //TODO_C dev

  const onClose = () => {
    Toast.notificationAPI?.destroy(TOO_MANY_BUCKETS_TOAST_KEY);
    UserLocalStorage.setItem("suppressBucketWarning", neverShowAgainRef.toString());
  };
  const handleCheckboxChange = (event: CheckboxChangeEvent) => {
    neverShowAgainRef = event.target.checked;
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
  const closeButton = <Button onClick={onClose}>Close</Button>;
  const linkToDocsButton = (
    <Button href={linkToDocs} target="_blank" rel="noopener noreferrer" type="primary">
      Learn how
    </Button>
  );
  const footer = (
    <Space>
      {linkToDocsButton}
      {closeButton}
    </Space>
  );

  const suppressManyBucketUpdatesWarning = UserLocalStorage.getItem(
    WARNING_SUPPRESSION_USER_STORAGE_KEY,
  );

  if (
    (suppressManyBucketUpdatesWarning || (false as boolean)) !== true &&
    dontShowAgainInThisSession !== true
  ) {
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
        className: "many-bucket-updates-warning",
      },
    );
    setDontShowAgainInThisSession(true);
  } else {
    console.log("suppressing warning toast"); //TODO_C dev
  }
}

export default function* manyBucketUpdatesWarningSaga(): Saga<void> {
  yield takeEvery("WK_READY", manyBucketUpdatesWarning);
}
