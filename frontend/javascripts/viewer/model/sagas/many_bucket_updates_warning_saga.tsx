import { Button, Checkbox, type CheckboxChangeEvent, Space } from "antd";
import Toast from "libs/toast";
import UserLocalStorage from "libs/user_local_storage";
import { stringToBoolean } from "libs/utils";
import { takeEvery } from "typed-redux-saga";
import type { Saga } from "viewer/model/sagas/effect-generators";

const TOO_MANY_BUCKETS_TOAST_KEY = "manyBucketUpdatesWarningToast";
const WARNING_SUPPRESSION_USER_STORAGE_KEY = "suppressManyBucketUpdatesWarning";

function* manyBucketUpdatesWarning(): Saga<void> {
  let showWarningToastInThisSession = true;
  const setShowWarningToastInThisSession = (value: boolean) => {
    showWarningToastInThisSession = value;
  };
  setInterval(() => {
    UserLocalStorage.setItem(WARNING_SUPPRESSION_USER_STORAGE_KEY, "false");
    console.log("resetting suppressBucketWarning to false every 120s for dev purposes");
  }, 120 * 1000);
  //TODO_C dev

  function* showWarningToast(): Saga<void> {
    let neverShowAgain = false;

    const onClose = () => {
      Toast.notificationAPI?.destroy(TOO_MANY_BUCKETS_TOAST_KEY);
      if (neverShowAgain) {
        UserLocalStorage.setItem(WARNING_SUPPRESSION_USER_STORAGE_KEY, neverShowAgain.toString());
      }
    };
    const handleCheckboxChange = (event: CheckboxChangeEvent) => {
      neverShowAgain = event.target.checked;
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

    const suppressManyBucketUpdatesWarning = stringToBoolean(
      UserLocalStorage.getItem(WARNING_SUPPRESSION_USER_STORAGE_KEY) || "false",
    );

    if (showWarningToastInThisSession && !suppressManyBucketUpdatesWarning) {
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
      setShowWarningToastInThisSession(false);
    } else {
      console.log("suppressing warning toast"); //TODO_C dev
    }
  }
  yield takeEvery("SHOW_MANY_BUCKET_UPDATES_WARNING", showWarningToast);
}

export default function* manyBucketUpdatesWarningSaga(): Saga<void> {
  yield takeEvery("WK_READY", manyBucketUpdatesWarning);
}
