import Icon, { LockOutlined } from "@ant-design/icons";
import ReadOnlyIcon from "@images/icons/icon-read-only.svg?react";
import FastTooltip from "components/fast_tooltip";
import LinkButton from "components/link_button";

export const LOCKED_ANNOTATION_EXPLANATION =
  "While annotations are locked, they cannot be edited. Can be used to prevent accidental editing for published annotations.";

// The "read-only" and "locked" labels of an annotation, as shown in the annotation list
// and its details sidebar.
export function AnnotationStatusLabels({
  isReadOnly,
  isLocked,
}: {
  isReadOnly: boolean;
  isLocked: boolean;
}) {
  return (
    <>
      {isReadOnly ? (
        <LinkButton
          disabled
          className="dashboard-annotation-status-label"
          icon={<Icon component={ReadOnlyIcon} />}
        >
          read-only
        </LinkButton>
      ) : null}
      {isLocked ? (
        <FastTooltip title={LOCKED_ANNOTATION_EXPLANATION}>
          <LinkButton
            disabled
            className="dashboard-annotation-status-label"
            icon={<LockOutlined />}
          >
            locked
          </LinkButton>
        </FastTooltip>
      ) : null}
    </>
  );
}
