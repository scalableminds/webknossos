import { InfoCircleOutlined } from "@ant-design/icons";
import { Space, Tag } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import { formatUserName } from "viewer/model/accessors/user_accessor";

export function OwnerAndContributorsBlocks() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const owner = useWkSelector((state) => state.annotation.owner);
  const contributors = useWkSelector((state) => state.annotation.contributors);

  if (!owner) {
    return null;
  }

  const contributorTags =
    contributors.length > 0
      ? contributors.map((user) => (
          <Tag key={user.id} color="blue" variant="outlined">
            {formatUserName(activeUser, user)}
          </Tag>
        ))
      : [
          <Tag key="None" color="blue" variant="outlined">
            None
          </Tag>,
        ];

  return (
    <>
      <div className="info-tab-block">
        <p className="sidebar-label">Owner</p>
        <p>
          <Tag color="blue" variant="outlined">
            {formatUserName(activeUser, owner)}
          </Tag>
        </p>
      </div>
      <div className="info-tab-block">
        <p className="sidebar-label">
          Contributors
          <FastTooltip title='If other users edited this annotation, they will be listed here. You can allow other users to edit the annotation by opening the "Share" dialog from the dropdown menu.'>
            <InfoCircleOutlined
              style={{
                marginLeft: 6,
              }}
            />
          </FastTooltip>
        </p>
        <div>
          <Space size={4} wrap>
            {contributorTags}
          </Space>
        </div>
      </div>
    </>
  );
}
