// @flow
import { Alert, Divider, Radio, Modal, Input, Button, Row, Col } from "antd";
import { CopyOutlined, ShareAltOutlined } from "@ant-design/icons";
import ButtonComponent from "oxalis/view/components/button_component";
import { useSelector } from "react-redux";
import React, { useState, useEffect } from "react";
import type { APIDataset, APIAnnotationVisibility, APIAnnotationType } from "types/api_flow_types";
import {
  getDatasetSharingToken,
  getTeamsForSharedAnnotation,
  updateTeamsForSharedAnnotation,
  editAnnotation,
  sendAnalyticsEvent,
} from "admin/admin_rest_api";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import Toast from "libs/toast";
import { location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import Store from "oxalis/store";
import UrlManager from "oxalis/controller/url_manager";
import { setAnnotationVisibilityAction } from "oxalis/model/actions/annotation_actions";
import { setShareModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import { ControlModeEnum } from "oxalis/constants";

const RadioGroup = Radio.Group;

const sharingActiveNode = true;

type Props = {|
  isVisible: boolean,
  onOk: () => void,
  annotationType: APIAnnotationType,
  annotationId: string,
|};

function Hint({ children, style }) {
  return (
    <div
      style={{
        ...style,
        marginBottom: 12,
        fontSize: 12,
        color: "var(--ant-text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

export function useDatasetSharingToken(dataset: APIDataset) {
  const [datasetToken, setDatasetToken] = useState("");
  const fetchAndSetToken = async () => {
    try {
      const sharingToken = await getDatasetSharingToken(dataset, { showErrorToast: false });
      setDatasetToken(sharingToken);
    } catch (error) {
      console.error(error);
    }
  };
  useEffect(() => {
    fetchAndSetToken();
  }, [dataset]);
  return datasetToken;
}

export function getUrl(sharingToken: string, includeToken: boolean) {
  const { pathname, origin } = location;
  const hash = UrlManager.buildUrlHashJson(Store.getState());
  const query = includeToken ? `?token=${sharingToken}` : "";
  const url = `${origin}${pathname}${query}#${hash}`;
  return url;
}

export async function copyUrlToClipboard(url: string) {
  await navigator.clipboard.writeText(url);
  Toast.success("URL copied to clipboard.");
}

export function ShareButton(props: { dataset: APIDataset, style?: Object }) {
  const { dataset, style } = props;
  const sharingToken = useDatasetSharingToken(props.dataset);
  const annotationVisibility = useSelector(state => state.tracing.visibility);
  const controlMode = useSelector(state => state.temporaryConfiguration.controlMode);
  const isViewMode = controlMode === ControlModeEnum.VIEW;
  const isSandboxMode = controlMode === ControlModeEnum.SANDBOX;
  const isTraceMode = controlMode === ControlModeEnum.TRACE;
  const annotationIsPublic = annotationVisibility === "Public";
  // For annotations, a token is included if the annotation is configured to be public, but the
  // dataset is not public. For datasets or sandboxes, a token is included if the dataset is not public.
  const includeToken = !dataset.isPublic && (isViewMode || isSandboxMode || annotationIsPublic);

  const copySharingUrl = () => {
    // Copy the url on-demand as it constantly changes
    const url = getUrl(sharingToken, includeToken);
    copyUrlToClipboard(url);
    if (isTraceMode && !annotationIsPublic) {
      // For public annotations and in dataset view mode, the link will work for all users.
      // Otherwise, show a warning that the link may not work for all users.
      Toast.warning(
        <>
          The sharing link can only be opened by users who have the correct permissions to see this
          dataset/annotation. Please open the{" "}
          <a href="#" onClick={() => Store.dispatch(setShareModalVisibilityAction(true))}>
            share dialog
          </a>{" "}
          if you want to configure this.
        </>,
      );
    }
    if (isSandboxMode) {
      Toast.warning(
        "For sandboxes, changes are neither saved nor shared. If you want to share the changes in this sandbox" +
          " use the 'Copy To My Account' functionality and share the resulting annotation.",
      );
    }
  };

  return (
    <ButtonComponent
      icon={<ShareAltOutlined />}
      title={messages["tracing.copy_sharing_link"]}
      onClick={copySharingUrl}
      style={style}
    />
  );
}

export default function ShareModalView(props: Props) {
  const { isVisible, onOk, annotationType, annotationId } = props;
  const dataset = useSelector(state => state.dataset);
  const annotationVisibility = useSelector(state => state.tracing.visibility);
  const restrictions = useSelector(state => state.tracing.restrictions);
  const [visibility, setVisibility] = useState(annotationVisibility);
  const [sharedTeams, setSharedTeams] = useState([]);
  const sharingToken = useDatasetSharingToken(dataset);
  const hasUpdatePermissions = restrictions.allowUpdate && restrictions.allowSave;
  useEffect(() => setVisibility(annotationVisibility), [annotationVisibility]);

  const fetchAndSetSharedTeams = async () => {
    const fetchedSharedTeams = await getTeamsForSharedAnnotation(annotationType, annotationId, {
      showErrorToast: false,
    });
    setSharedTeams(fetchedSharedTeams);
  };
  useEffect(() => {
    fetchAndSetSharedTeams();
  }, [annotationType, annotationId]);

  const handleCheckboxChange = (event: SyntheticInputEvent<>) => {
    setVisibility(((event.target.value: any): APIAnnotationVisibility));
  };

  const handleOk = async () => {
    await editAnnotation(annotationId, annotationType, {
      visibility,
    });

    Store.dispatch(setAnnotationVisibilityAction(visibility));

    if (visibility !== "Private") {
      await updateTeamsForSharedAnnotation(
        annotationType,
        annotationId,
        sharedTeams.map(team => team.id),
      );
      Toast.success(messages["annotation.shared_teams_edited"]);
    }
    sendAnalyticsEvent("share_annotation", { visibility });
    onOk();
  };

  const maybeShowWarning = () => {
    let message;
    if (!hasUpdatePermissions) {
      message = "You don't have the permission to edit the visibility of this annotation.";
    } else if (!dataset.isPublic && visibility === "Public") {
      message =
        "The dataset of this annotation is not public. The Sharing Link will make the dataset accessible to everyone you share it with.";
    } else if (visibility === "Private") {
      message =
        "The annotation is currently private, so Team Sharing is disabled and only admins and team managers can use the Sharing Link.";
    }

    return message != null ? (
      <Alert style={{ marginBottom: 18 }} message={message} type="warning" showIcon />
    ) : null;
  };

  const radioStyle = {
    display: "block",
    height: "30px",
    lineHeight: "30px",
  };

  const iconMap = {
    Public: "globe",
    Internal: "users",
    Private: "lock",
  };

  const includeToken = !dataset.isPublic && visibility === "Public";
  const url = getUrl(sharingToken, includeToken);

  return (
    <Modal
      title="Share this Annotation"
      visible={isVisible}
      width={800}
      okText={hasUpdatePermissions ? "Save" : "Ok"}
      onOk={hasUpdatePermissions ? handleOk : onOk}
      onCancel={onOk}
    >
      <Row>
        <Col span={6} style={{ lineHeight: "30px" }}>
          Sharing Link
        </Col>
        <Col span={18}>
          <Input.Group compact>
            <Input style={{ width: "85%" }} value={url} readOnly />
            <Button
              style={{ width: "15%" }}
              onClick={() => copyUrlToClipboard(url)}
              icon={<CopyOutlined />}
            >
              Copy
            </Button>
          </Input.Group>
          <Hint style={{ margin: "6px 12px" }}>
            {messages["tracing.sharing_modal_basic_information"](sharingActiveNode)}
          </Hint>
        </Col>
      </Row>
      <Divider style={{ margin: "18px 0" }}>
        <i className={`fas fa-${iconMap[visibility]}`} />
        Visibility
      </Divider>
      {maybeShowWarning()}
      <Row>
        <Col span={6} style={{ lineHeight: "28px" }}>
          Who can view this annotation?
        </Col>
        <Col span={18}>
          <RadioGroup onChange={handleCheckboxChange} value={visibility}>
            <Radio style={radioStyle} value="Private" disabled={!hasUpdatePermissions}>
              Private
            </Radio>
            <Hint style={{ marginLeft: 24 }}>
              Only you and your team manager can view this annotation.
            </Hint>

            <Radio style={radioStyle} value="Internal" disabled={!hasUpdatePermissions}>
              Internal
            </Radio>
            <Hint style={{ marginLeft: 24 }}>
              All users in your organization{" "}
              {dataset.isPublic ? "" : "who have access to this dataset"} can view this annotation
              and copy it to their accounts to edit it.
            </Hint>

            <Radio style={radioStyle} value="Public" disabled={!hasUpdatePermissions}>
              Public
            </Radio>
            <Hint style={{ marginLeft: 24 }}>
              Anyone with the link can see this annotation without having to log in.
            </Hint>
          </RadioGroup>
        </Col>
      </Row>
      <Divider style={{ margin: "18px 0" }}>
        <ShareAltOutlined />
        Team Sharing
      </Divider>
      <Row>
        <Col span={6} style={{ lineHeight: "22px" }}>
          Should this annotation appear in the sharing tab?
        </Col>
        <Col span={18}>
          <TeamSelectionComponent
            mode="multiple"
            allowNonEditableTeams
            value={sharedTeams}
            onChange={value => setSharedTeams(_.flatten([value]))}
            disabled={!hasUpdatePermissions || visibility === "Private"}
          />
          <Hint style={{ margin: "6px 12px" }}>
            Choose the teams to share your annotation with. Members of these teams can see this
            annotation in their shared annotations tab.
          </Hint>
        </Col>
      </Row>
    </Modal>
  );
}
