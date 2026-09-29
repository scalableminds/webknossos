import Icon, { LockOutlined } from "@ant-design/icons";
import ReadOnlyIcon from "@images/icons/icon-read-only.svg?react";
import LinkButton from "components/link_button";

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
        <LinkButton disabled className="dashboard-annotation-status-label" icon={<LockOutlined />}>
          locked
        </LinkButton>
      ) : null}
    </>
  );
}
