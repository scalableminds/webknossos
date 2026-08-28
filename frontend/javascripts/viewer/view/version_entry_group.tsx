import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import { Avatar, List } from "antd";
import FormattedDate from "components/formatted_date";
import last from "lodash-es/last";
import max from "lodash-es/max";
import { Component, Fragment } from "react";
import type { APIUpdateActionBatch } from "types/api_types";
import VersionEntry from "viewer/view/version_entry";

type Props = {
  batches: APIUpdateActionBatch[];
  initialAllowUpdate: boolean;
  newestVersion: number;
  activeVersion: number;
  // The expansion state is controlled by the parent so that it survives the
  // virtualized list unmounting off-screen groups.
  expanded: boolean;
  onSetExpanded: (expanded: boolean) => void;
  onRestoreVersion: (arg0: number) => Promise<void>;
  onPreviewVersion: (arg0: number) => Promise<void>;
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
  const lastTimestamp = max(batches[0].value.map((action) => action.value.actionTimestamp)) || 0;
  const lastVersion = last(batches)?.version || 0;
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
          <Fragment>
            {lastVersion} to {batches[0].version} (
            <FormattedDate timestamp={lastTimestamp} format="HH:mm" />)
          </Fragment>
        }
        avatar={
          <Avatar size="small" icon={expanded ? <CaretDownOutlined /> : <CaretRightOutlined />} />
        }
      />
    </List.Item>
  );
}
// Returns whether the given group contains the active version. Used by the
// parent to decide the default expansion state for a group.
export function isActiveVersionInGroup(
  batches: APIUpdateActionBatch[],
  activeVersion: number,
): boolean {
  const newestBatch = batches.at(0);
  const oldestBatch = batches.at(-1);
  return (
    newestBatch != null &&
    oldestBatch != null &&
    oldestBatch.version <= activeVersion &&
    activeVersion <= newestBatch.version
  );
}

export default class VersionEntryGroup extends Component<Props> {
  toggleExpand = () => {
    this.props.onSetExpanded(!this.props.expanded);
  };

  render() {
    const {
      batches,
      initialAllowUpdate,
      newestVersion,
      activeVersion,
      expanded,
      onRestoreVersion,
      onPreviewVersion,
    } = this.props;

    const containsMultipleBatches = batches.length > 1;
    return (
      <Fragment>
        {containsMultipleBatches ? (
          <GroupHeader toggleExpand={this.toggleExpand} expanded={expanded} batches={batches} />
        ) : null}
        {expanded || !containsMultipleBatches
          ? batches.map((batch) => (
              <VersionEntry
                initialAllowUpdate={initialAllowUpdate}
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
      </Fragment>
    );
  }
}
