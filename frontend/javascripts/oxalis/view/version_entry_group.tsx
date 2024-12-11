import * as React from "react";
import { Avatar, List } from "antd";
import _ from "lodash";
import type { APIUpdateActionBatch } from "types/api_flow_types";
import FormattedDate from "components/formatted_date";
import VersionEntry from "oxalis/view/version_entry";
import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";

type Props = {
  batches: APIUpdateActionBatch[];
  allowEditing: boolean;
  newestVersion: number;
  activeVersion: number;
  onRestoreVersion: (arg0: number) => Promise<void>;
  onPreviewVersion: (arg0: number) => Promise<void>;
};
type State = {
  expanded: boolean;
};

function GroupHeader({
  toggleExpand,
  expanded,
  batches,
}: {
  toggleExpand: () => void;
  expanded: boolean;
  batches: APIUpdateActionBatch[];
}) {
  const lastTimestamp = _.max(batches[0].value.map((action) => action.value.actionTimestamp)) || 0;
  const lastVersion = _.last(batches)?.version || 0;
  return (
    <List.Item
      style={{
        cursor: "pointer",
      }}
      className="version-entry version-entry-header"
      onClick={toggleExpand}
    >
      <List.Item.Meta
        title={
          <React.Fragment>
            {lastVersion} to {batches[0].version} (
            <FormattedDate timestamp={lastTimestamp} format="HH:mm" />)
          </React.Fragment>
        }
        avatar={
          <Avatar size="small" icon={expanded ? <CaretDownOutlined /> : <CaretRightOutlined />} />
        }
      />
    </List.Item>
  );
}
export default class VersionEntryGroup extends React.Component<Props, State> {
  state: State = {
    expanded: false,
  };

  toggleExpand = () => {
    this.setState((prevState) => ({
      expanded: !prevState.expanded,
    }));
  };

  render() {
    const {
      batches,
      allowEditing,
      newestVersion,
      activeVersion,
      onRestoreVersion,
      onPreviewVersion,
    } = this.props;

    const containsMultipleBatches = batches.length > 1;
    return (
      <React.Fragment>
        {containsMultipleBatches ? (
          <GroupHeader
            toggleExpand={this.toggleExpand}
            expanded={this.state.expanded}
            batches={batches}
          />
        ) : null}
        {this.state.expanded || !containsMultipleBatches
          ? batches.map((batch) => (
              <VersionEntry
                allowEditing={allowEditing}
                isIndented={containsMultipleBatches}
                actions={batch.value}
                version={batch.version}
                isNewest={batch.version === newestVersion}
                isActive={batch.version === activeVersion}
                onRestoreVersion={onRestoreVersion}
                onPreviewVersion={onPreviewVersion}
                key={batch.version}
              />
            ))
          : null}
      </React.Fragment>
    );
  }
}
