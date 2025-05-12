import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";
import { Avatar, List } from "antd";
import FormattedDate from "components/formatted_date";
import _ from "lodash";
import * as React from "react";
import type { APIUpdateActionBatch } from "types/api_types";
import VersionEntry from "viewer/view/version_entry";

type Props = {
  batches: APIUpdateActionBatch[];
  initialAllowUpdate: boolean;
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

  componentDidMount() {
    const newestBatch = this.props.batches.at(0);
    const oldestBatch = this.props.batches.at(-1);
    if (
      newestBatch &&
      oldestBatch &&
      oldestBatch.version <= this.props.activeVersion &&
      this.props.activeVersion <= newestBatch.version
    ) {
      this.setState({ expanded: true });
    }
  }

  render() {
    const {
      batches,
      initialAllowUpdate,
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
      </React.Fragment>
    );
  }
}
