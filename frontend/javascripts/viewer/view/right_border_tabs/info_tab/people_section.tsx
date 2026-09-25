import { InfoCircleOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import type { APIUser, APIUserBase } from "types/api_types";
import { InfoTabRow, InfoTabSection } from "./info_tab_layout";

const CONTRIBUTORS_EXPLANATION =
  'If other users edited this annotation, they will be listed here. You can allow other users to edit the annotation by opening the "Share" dialog from the dropdown menu.';

export function PeopleSection() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const owner = useWkSelector((state) => state.annotation.owner);
  const contributors = useWkSelector((state) => state.annotation.contributors);

  if (!owner) {
    return null;
  }

  return (
    <InfoTabSection label="People">
      <InfoTabRow label="Owner">
        <UserName user={owner} activeUser={activeUser} />
      </InfoTabRow>
      <InfoTabRow
        label="Contributors"
        labelSuffix={
          <FastTooltip title={CONTRIBUTORS_EXPLANATION}>
            <InfoCircleOutlined />
          </FastTooltip>
        }
      >
        {contributors.length > 0 ? (
          <span>
            {contributors.map((user, index) => (
              <span key={user.id}>
                {index > 0 ? ", " : ""}
                <UserName user={user} activeUser={activeUser} />
              </span>
            ))}
          </span>
        ) : (
          // Read-only values are plain text — a chip would promise a click that does not exist.
          <span className="info-tab-muted">None</span>
        )}
      </InfoTabRow>
    </InfoTabSection>
  );
}

function UserName({
  user,
  activeUser,
}: {
  user: APIUserBase;
  activeUser: APIUser | null | undefined;
}) {
  return (
    <span>
      {user.firstName} {user.lastName}
      {activeUser?.id === user.id ? <span className="info-tab-muted"> (you)</span> : null}
    </span>
  );
}
