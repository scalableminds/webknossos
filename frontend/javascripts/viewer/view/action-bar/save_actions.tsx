import { CodeSandboxOutlined, FileAddOutlined } from "@ant-design/icons";
import { withAuthentication } from "admin/auth/authentication_modal";
import { createExplorational, duplicateAnnotation } from "admin/rest_api";
import { Button, Tooltip } from "antd";
import { AsyncButton, type AsyncButtonProps } from "components/async_clickables";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { location } from "libs/window";
import type React from "react";
import { useCallback } from "react";
import { useDispatch } from "react-redux";
import { type APIUser, TracingTypeEnum } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import UrlManager from "viewer/controller/url_manager";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { getTracingType } from "viewer/model/accessors/tracing_accessor";
import { setSkeletonTracingAction } from "viewer/model/actions/skeletontracing_actions";
import { Model, api } from "viewer/singletons";
import Store from "viewer/store";
import SaveButton from "viewer/view/action-bar/save_button";
import ButtonComponent from "viewer/view/components/button_component";
import UndoRedoActions from "./undo_redo_actions";

const AsyncButtonWithAuthentication = withAuthentication<AsyncButtonProps, typeof AsyncButton>(
  AsyncButton,
);

const handleSave = async (event?: React.MouseEvent<HTMLButtonElement>) => {
  if (event != null) {
    (event.target as HTMLButtonElement).blur();
  }

  Model.forceSave();
};

function ReadOnlyActions({
  activeUser,
  copyAnnotationText,
}: {
  activeUser: APIUser | null | undefined;
  copyAnnotationText: string;
}) {
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const annotationType = useWkSelector((state) => state.annotation.annotationType);

  const handleCopyToAccount = useCallback(async () => {
    // duplicates the annotation in the current user account
    const newAnnotation = await duplicateAnnotation(annotationId, annotationType);
    location.href = `/annotations/${newAnnotation.id}`;
  }, [annotationId, annotationType]);

  return (
    <>
      <ButtonComponent
        key="read-only-button"
        danger
        disabled
        style={{
          backgroundColor: "var(--ant-color-warning)",
        }}
      >
        Read only
      </ButtonComponent>
      <AsyncButtonWithAuthentication
        activeUser={activeUser}
        authenticationMessage="Please register or login to copy the tracing to your account."
        key="copy-button"
        icon={<FileAddOutlined />}
        onClick={handleCopyToAccount}
        title={copyAnnotationText}
      >
        <span className="hide-on-small-screen">{copyAnnotationText}</span>
      </AsyncButtonWithAuthentication>
    </>
  );
}

function SandboxActions({
  activeUser,
  copyAnnotationText,
}: {
  activeUser: APIUser | null | undefined;
  copyAnnotationText: string;
}) {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  const annotation = useWkSelector((state) => state.annotation);

  const handleCopySandboxToAccount = useCallback(async () => {
    const sandboxAnnotation = annotation;
    const tracingType = getTracingType(sandboxAnnotation);

    if (tracingType !== TracingTypeEnum.skeleton) {
      const message = "Sandbox copying functionality is only implemented for skeleton tracings.";
      Toast.error(message);
      throw Error(message);
    }

    const newAnnotation = await createExplorational(dataset.id, tracingType, false);
    UrlManager.changeBaseUrl(`/annotations/${newAnnotation.typ}/${newAnnotation.id}`);
    await api.tracing.restart(null, newAnnotation.id, ControlModeEnum.TRACE, undefined, true);
    const sandboxSkeletonTracing = enforceSkeletonTracing(sandboxAnnotation);
    const skeletonTracing = enforceSkeletonTracing(Store.getState().annotation);

    // Update the sandbox tracing with the new tracingId and createdTimestamp
    const newSkeletonTracing = {
      ...sandboxSkeletonTracing,
      tracingId: skeletonTracing.tracingId,
      createdTimestamp: skeletonTracing.createdTimestamp,
    };
    dispatch(setSkeletonTracingAction(newSkeletonTracing));
    await Model.ensureSavedState();

    // Do a complete page refresh, because the URL changed and the router
    // would cause a reload the next time the URL hash changes (because the
    // TracingLayoutView would be remounted).
    location.reload();
  }, [dispatch, annotation, dataset]);

  return (
    <>
      <Tooltip
        placement="bottom"
        title="This annotation was opened in sandbox mode. You can edit it, but changes are not saved. Use 'Copy To My Account' to copy the current state to your account."
        key="sandbox-tooltip"
      >
        <Button disabled type="primary" icon={<CodeSandboxOutlined />}>
          <span className="hide-on-small-screen">Sandbox</span>
        </Button>
      </Tooltip>
      <AsyncButtonWithAuthentication
        activeUser={activeUser}
        authenticationMessage="Please register or login to copy the sandbox tracing to your account."
        key="copy-sandbox-button"
        icon={<FileAddOutlined />}
        onClick={handleCopySandboxToAccount}
        title={copyAnnotationText}
      >
        <span className="hide-on-small-screen">Copy To My Account</span>
      </AsyncButtonWithAuthentication>
    </>
  );
}

function SaveActions() {
  const restrictions = useWkSelector((state) => state.annotation.restrictions);
  const annotationOwner = useWkSelector((state) => state.annotation.owner);
  const activeUser = useWkSelector((state) => state.activeUser);
  const hasTracing = useWkSelector(
    (state) => state.annotation.skeleton != null || state.annotation.volumes.length > 0,
  );
  const busyBlockingInfo = useWkSelector((state) => state.uiInformation.busyBlockingInfo);

  const isAnnotationOwner = activeUser && annotationOwner?.id === activeUser?.id;
  const copyAnnotationText = isAnnotationOwner ? "Duplicate" : "Copy To My Account";

  if (!restrictions.allowUpdate) {
    return <ReadOnlyActions activeUser={activeUser} copyAnnotationText={copyAnnotationText} />;
  }

  if (!restrictions.allowSave) {
    return (
      <>
        <UndoRedoActions hasTracing={hasTracing} isBusy={busyBlockingInfo.isBusy} />
        <SandboxActions activeUser={activeUser} copyAnnotationText={copyAnnotationText} />
      </>
    );
  }

  return (
    <>
      <UndoRedoActions hasTracing={hasTracing} isBusy={busyBlockingInfo.isBusy} />
      <SaveButton className="narrow" key="save-button" onClick={handleSave} />
    </>
  );
}

export default SaveActions;
