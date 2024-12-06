import {
  Alert,
  Divider,
  Radio,
  Modal,
  Input,
  Button,
  Row,
  Col,
  type RadioChangeEvent,
  Tooltip,
  Space,
} from "antd";
import { CompressOutlined, CopyOutlined, ShareAltOutlined } from "@ant-design/icons";
import { useSelector } from "react-redux";
import type React from "react";
import { useState, useEffect } from "react";
import type {
  APIDataset,
  APIAnnotationVisibility,
  APIAnnotationType,
  APITeam,
} from "types/api_flow_types";
import {
  getDatasetSharingToken,
  getTeamsForSharedAnnotation,
  updateTeamsForSharedAnnotation,
  editAnnotation,
  sendAnalyticsEvent,
  setOthersMayEditForAnnotation,
  getSharingTokenFromUrlParameters,
  createShortLink,
} from "admin/admin_rest_api";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import Toast from "libs/toast";
import { location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import Store, { type OxalisState } from "oxalis/store";
import UrlManager from "oxalis/controller/url_manager";
import {
  setAnnotationVisibilityAction,
  setOthersMayEditForAnnotationAction,
} from "oxalis/model/actions/annotation_actions";
import { setShareModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import { ControlModeEnum } from "oxalis/constants";
import { makeComponentLazy } from "libs/react_helpers";
import { AsyncButton } from "components/async_clickables";
import { PricingEnforcedBlur } from "components/pricing_enforcers";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import { mayEditAnnotationProperties } from "oxalis/model/accessors/annotation_accessor";
import { formatUserName } from "oxalis/model/accessors/user_accessor";

const RadioGroup = Radio.Group;
const sharingActiveNode = true;
type Props = {
  isOpen: boolean;
  onOk: () => void;
  annotationType: APIAnnotationType;
  annotationId: string;
};

function Hint({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) {
  return (
    <div
      style={{
        ...style,
        marginTop: 4,
        marginBottom: 12,
        fontSize: 12,
        color: "var(--ant-color-text-secondary)",
      }}
    >
      {children}
    </div>
  );
}

export function useDatasetSharingToken(dataset: APIDataset) {
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const [datasetToken, setDatasetToken] = useState("");

  const getAndSetToken = async () => {
    // If the current URL contains a token, we can simply use
    // that as a sharing token. Otherwise, users who are currently
    // visiting a sharing URL might not be able to use the share button,
    // because they might not have permissions to GET the dataset's
    // sharing token.
    const urlToken = getSharingTokenFromUrlParameters();
    if (urlToken != null) {
      setDatasetToken(urlToken);
      return;
    }
    if (!activeUser) {
      return;
    }
    try {
      const sharingToken = await getDatasetSharingToken(dataset.id, {
        doNotInvestigate: true,
      });
      setDatasetToken(sharingToken);
    } catch (error) {
      console.error(error);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: Update token once dataset or user changes.
  useEffect(() => {
    getAndSetToken();
  }, [dataset, activeUser]);
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
export function ShareButton(props: { dataset: APIDataset; style?: Record<string, any> }) {
  const { dataset, style } = props;
  const sharingToken = useDatasetSharingToken(props.dataset);
  const annotationVisibility = useSelector((state: OxalisState) => state.tracing.visibility);
  const controlMode = useSelector((state: OxalisState) => state.temporaryConfiguration.controlMode);
  const isViewMode = controlMode === ControlModeEnum.VIEW;
  const isSandboxMode = controlMode === ControlModeEnum.SANDBOX;
  const isTraceMode = controlMode === ControlModeEnum.TRACE;
  const annotationIsPublic = annotationVisibility === "Public";
  // For annotations, a token is included if the annotation is configured to be public, but the
  // dataset is not public. For datasets or sandboxes, a token is included if the dataset is not public.
  const includeToken = !dataset.isPublic && (isViewMode || isSandboxMode || annotationIsPublic);

  const createAndCopySharingUrl = async () => {
    // Copy the url on-demand as it constantly changes
    const url = getUrl(sharingToken, includeToken);
    const shortLink = await createShortLink(url);

    copyUrlToClipboard(`${location.origin}/links/${shortLink.key}`);

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
    <AsyncButton
      icon={<ShareAltOutlined />}
      title={messages["tracing.copy_sharing_link"]}
      onClick={createAndCopySharingUrl}
      style={style}
    />
  );
}

function _ShareModalView(props: Props) {
  const { isOpen, onOk, annotationType, annotationId } = props;
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const isAnnotationLockedByUser = tracing.isLockedByOwner;

  const annotationVisibility = tracing.visibility;
  const [visibility, setVisibility] = useState(annotationVisibility);
  const [isChangingInProgress, setIsChangingInProgress] = useState(false);
  const [sharedTeams, setSharedTeams] = useState<APITeam[]>([]);
  const sharingToken = useDatasetSharingToken(dataset);

  const { othersMayEdit } = tracing;
  const [newOthersMayEdit, setNewOthersMayEdit] = useState(othersMayEdit);

  const hasUpdatePermissions = useSelector(mayEditAnnotationProperties);
  useEffect(() => setVisibility(annotationVisibility), [annotationVisibility]);

  const fetchAndSetSharedTeams = async () => {
    if (!activeUser) {
      return;
    }
    const fetchedSharedTeams = await getTeamsForSharedAnnotation(annotationType, annotationId);
    setSharedTeams(fetchedSharedTeams);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: Refetch once annotation or user changes.
  useEffect(() => {
    fetchAndSetSharedTeams();
  }, [annotationType, annotationId, activeUser]);

  const reportSuccessfulChange = (newVisibility: APIAnnotationVisibility) => {
    const randomKeyToAllowDuplicates = Math.random().toString(36).substring(0, 5);
    Toast.success(messages["annotation.shared_teams_edited"], {
      timeout: 3500,
      key: randomKeyToAllowDuplicates,
    });

    sendAnalyticsEvent("share_annotation", {
      visibility: newVisibility,
    });
  };

  const reportFailedChange = () => {
    const randomKeyToAllowDuplicates = Math.random().toString(36).substring(0, 5);
    Toast.error(messages["annotation.shared_teams_edited_failed"], {
      timeout: 3500,
      key: randomKeyToAllowDuplicates,
    });
  };

  const handleCheckboxChange = async (event: RadioChangeEvent) => {
    const newVisibility = event.target.value as any as APIAnnotationVisibility;
    if (newVisibility === visibility || !hasUpdatePermissions) {
      return;
    }
    setIsChangingInProgress(true);
    setVisibility(newVisibility as any as APIAnnotationVisibility);
    try {
      await editAnnotation(annotationId, annotationType, {
        visibility: newVisibility,
      });
      Store.dispatch(setAnnotationVisibilityAction(newVisibility));
      reportSuccessfulChange(newVisibility);
    } catch (e) {
      console.error("Failed to update the annotations visibility.", e);
      // Resetting the visibility to the old value as the request failed
      // so the user still sees the settings currently saved in the backend.
      setVisibility(visibility as any as APIAnnotationVisibility);
      reportFailedChange();
    } finally {
      setIsChangingInProgress(false);
    }
  };

  const handleSharedTeamsChange = async (value: APITeam | APITeam[]) => {
    const newTeams = _.flatten([value]);
    if (_.isEqual(newTeams, sharedTeams)) {
      return;
    }
    setIsChangingInProgress(true);
    setSharedTeams(newTeams);
    try {
      await updateTeamsForSharedAnnotation(
        annotationType,
        annotationId,
        newTeams.map((team) => team.id),
      );
      reportSuccessfulChange(visibility);
    } catch (e) {
      console.error("Failed to update the annotations shared teams.", e);
      // Resetting the shared teams to the old value as the request failed
      // so the user still sees the settings currently saved in the backend.
      setSharedTeams(sharedTeams);
      reportFailedChange();
    } finally {
      setIsChangingInProgress(false);
    }
  };

  const handleOthersMayEditCheckboxChange = async (event: RadioChangeEvent) => {
    const value = event.target.value;
    if (typeof value !== "boolean") {
      throw new Error("Form element should return boolean value.");
    }

    setIsChangingInProgress(true);
    setNewOthersMayEdit(value);
    if (value !== othersMayEdit) {
      try {
        await setOthersMayEditForAnnotation(annotationId, annotationType, value);
        Store.dispatch(setOthersMayEditForAnnotationAction(value));
        reportSuccessfulChange(visibility);
      } catch (e) {
        console.error("Failed to update the edit option for others.", e);
        // Resetting the others may edit option to the old value as the request failed
        // so the user still sees the settings currently saved in the backend.
        setNewOthersMayEdit(newOthersMayEdit);
        reportFailedChange();
      } finally {
        setIsChangingInProgress(false);
      }
    }
  };

  const maybeShowWarning = () => {
    let message;
    if (isAnnotationLockedByUser) {
      message = `You can't change the visibility of this annotation because it is locked by ${formatUserName(
        activeUser,
        tracing.owner,
      )}.`;
    } else if (!hasUpdatePermissions) {
      message = "You don't have the permission to edit the visibility of this annotation.";
    } else if (!dataset.isPublic && visibility === "Public") {
      message =
        "The dataset of this annotation is not public. The Sharing Link will make the dataset accessible to everyone you share it with.";
    } else if (visibility === "Private") {
      message =
        "The annotation is currently private, so Team Sharing is disabled and only admins and team managers can use the Sharing Link.";
    }

    return message != null ? (
      <Alert
        style={{
          marginBottom: 18,
        }}
        message={message}
        type="warning"
        showIcon
      />
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
  const longUrl = getUrl(sharingToken, includeToken);

  return (
    <Modal
      title="Share this annotation"
      open={isOpen}
      width={800}
      onOk={onOk}
      onCancel={onOk}
      cancelButtonProps={{ style: { display: "none" } }}
    >
      <Row>
        <Col
          span={6}
          style={{
            lineHeight: "30px",
          }}
        >
          Sharing Link
        </Col>
        <Col span={18}>
          <CopyableSharingLink isVisible={isOpen} longUrl={longUrl} />
          <Hint
            style={{
              margin: "4px 9px 12px 4px",
            }}
          >
            {messages["tracing.sharing_modal_basic_information"](sharingActiveNode)}
          </Hint>
        </Col>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        <i className={`fas fa-${iconMap[visibility]} icon-margin-right`} />
        Visibility
      </Divider>
      {maybeShowWarning()}
      <Row>
        <Col
          span={6}
          style={{
            lineHeight: "28px",
          }}
        >
          Who can view this annotation?
        </Col>
        <Col span={18}>
          <RadioGroup
            onChange={handleCheckboxChange}
            value={visibility}
            disabled={isChangingInProgress}
          >
            <Radio style={radioStyle} value="Private" disabled={!hasUpdatePermissions}>
              Private
            </Radio>
            <Hint
              style={{
                marginLeft: 24,
              }}
            >
              Only you and your team manager can view this annotation.
            </Hint>

            <Radio style={radioStyle} value="Internal" disabled={!hasUpdatePermissions}>
              Internal
            </Radio>
            <Hint
              style={{
                marginLeft: 24,
              }}
            >
              All users in your organization{" "}
              {dataset.isPublic ? "" : "who have access to this dataset"} can view this annotation
              and copy it to their accounts to edit it.
            </Hint>

            <Radio style={radioStyle} value="Public" disabled={!hasUpdatePermissions}>
              Public
            </Radio>
            <Hint
              style={{
                marginLeft: 24,
              }}
            >
              Anyone with the link can see this annotation without having to log in.
            </Hint>
          </RadioGroup>
        </Col>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        <ShareAltOutlined className="icon-margin-right" />
        Team Sharing
      </Divider>
      <PricingEnforcedBlur requiredPricingPlan={PricingPlanEnum.Team}>
        <Row>
          <Col
            span={6}
            style={{
              lineHeight: "22px",
            }}
          >
            For which teams should this annotation be listed?
          </Col>
          <Col span={18}>
            <TeamSelectionComponent
              mode="multiple"
              allowNonEditableTeams
              value={sharedTeams}
              onChange={handleSharedTeamsChange}
              disabled={!hasUpdatePermissions || visibility === "Private" || isChangingInProgress}
            />
            <Hint
              style={{
                margin: "6px 12px",
              }}
            >
              Choose the teams to share your annotation with. Members of these teams can see this
              annotation in their Annotations tab.
            </Hint>
          </Col>
        </Row>

        <Row>
          <Col
            span={6}
            style={{
              lineHeight: "22px",
            }}
          >
            Are other users allowed to edit this annotation?
          </Col>
          <Col span={18}>
            <RadioGroup
              onChange={handleOthersMayEditCheckboxChange}
              value={newOthersMayEdit}
              disabled={isChangingInProgress}
            >
              <Radio style={radioStyle} value={false} disabled={!hasUpdatePermissions}>
                No, keep it read-only
              </Radio>
              <Hint
                style={{
                  marginLeft: 24,
                }}
              >
                Only you can edit the content of this annotation.
              </Hint>

              <Radio style={radioStyle} value disabled={!hasUpdatePermissions}>
                Yes, allow editing
              </Radio>
              <Hint
                style={{
                  marginLeft: 24,
                }}
              >
                All registered users that can view this annotation can edit it. Note that you should
                coordinate the collaboration, because parallel changes to this annotation will
                result in a conflict.
              </Hint>
            </RadioGroup>
          </Col>
        </Row>
      </PricingEnforcedBlur>
    </Modal>
  );
}

export function CopyableSharingLink({
  isVisible,
  longUrl,
}: {
  isVisible: boolean;
  longUrl: string;
}) {
  const [shortUrl, setShortUrl] = useState<string | null>(null);

  const [showShortLink, setShowShortLink] = useState(true);
  useEffect(() => {
    if (!isVisible || !showShortLink) {
      // Don't create new shortlinks when the user does not want/need them.
      // Set short url to null to avoid keeping a stale value.
      setShortUrl(null);
      return;
    }

    createShortLink(longUrl).then((shortLink) => {
      setShortUrl(`${location.origin}/links/${shortLink.key}`);
    });
  }, [longUrl, isVisible, showShortLink]);
  const linkToCopy = showShortLink ? shortUrl || longUrl : longUrl;

  return (
    <Space.Compact block>
      <Tooltip title="When enabled, the link is shortened automatically.">
        <Button
          type={showShortLink ? "primary" : "default"}
          onClick={() => setShowShortLink(!showShortLink)}
          style={{ padding: "0px 8px" }}
        >
          <CompressOutlined />
        </Button>
      </Tooltip>
      <Input
        style={{
          width: "78%",
        }}
        value={linkToCopy}
        readOnly
      />
      <Button onClick={() => copyUrlToClipboard(linkToCopy)} icon={<CopyOutlined />}>
        Copy
      </Button>
    </Space.Compact>
  );
}

const ShareModalView = makeComponentLazy(_ShareModalView);
export default ShareModalView;
