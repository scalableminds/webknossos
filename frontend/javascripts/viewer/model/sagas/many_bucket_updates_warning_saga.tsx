import { updateNovelUserExperienceInfos } from "admin/rest_api";
import { Button, Checkbox, type CheckboxChangeEvent, Space } from "antd";
import Toast from "libs/toast";
import { takeEvery } from "typed-redux-saga";
import { type Saga, select } from "viewer/model/sagas/effect-generators";
import type { WebknossosState } from "viewer/store";

const TOO_MANY_BUCKETS_TOAST_KEY = "manyBucketUpdatesWarningToast";

function* manyBucketUpdatesWarning(): Saga<void> {
  let showWarningToastInThisSession = true;
  const setShowWarningToastInThisSession = (value: boolean) => {
    showWarningToastInThisSession = value;
  };
  const suppressWarningToast = yield* select(
    (state: WebknossosState) =>
      state.activeUser?.novelUserExperienceInfos.suppressManyBucketUpdatesWarning,
  );
  if (suppressWarningToast) {
    return;
  }
  function* showWarningToast(): Saga<void> {
    const activeUser = yield* select((state) => state.activeUser);
    let neverShowAgain = false;

    const onClose = () => {
      Toast.notificationAPI?.destroy(TOO_MANY_BUCKETS_TOAST_KEY);
      if (neverShowAgain) {
        updateNovelUserExperienceInfos(activeUser, {
          suppressManyBucketUpdatesWarning: true,
        });
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

    if (showWarningToastInThisSession && !suppressWarningToast) {
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
    }
  }
  yield takeEvery("SHOW_MANY_BUCKET_UPDATES_WARNING", showWarningToast);
}

export default function* manyBucketUpdatesWarningSaga(): Saga<void> {
  yield takeEvery("WK_READY", manyBucketUpdatesWarning);
}
