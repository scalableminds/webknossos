import * as React from "react";
import { Avatar, List } from "antd";
import _ from "lodash";
import type { APIUpdateActionBatch } from "types/api_flow_types";
import FormattedDate from "components/formatted_date";
import VersionEntry from "oxalis/view/version_entry";
import { CaretDownOutlined, CaretRightOutlined } from "@ant-design/icons";

type Props = {
  batches: APIUpdateActionBatch[];
  allowUpdate: boolean;
  newestVersion: number;
  activeVersion: number;
  onRestoreVersion: (arg0: number) => Promise<void>;
  onPreviewVersion: (arg0: number) => Promise<void>;
};
type State = {
  expanded: boolean;
};

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
      allowUpdate,
      newestVersion,
      activeVersion,
      onRestoreVersion,
      onPreviewVersion,
    } = this.props;

    const lastTimestamp = _.max(batches[0].value.map((action) => action.value.actionTimestamp));

    const GroupHeader = () => (
      <List.Item
        style={{
          cursor: "pointer",
        }}
        className="version-entry version-entry-header"
        onClick={this.toggleExpand}
      >
        <List.Item.Meta
          title={
            <React.Fragment>
              {/* @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'. */}
              {_.last(batches).version} to {batches[0].version} (
              {/* @ts-expect-error ts-migrate(2322) FIXME: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message */}
              <FormattedDate timestamp={lastTimestamp} format="HH:mm" />)
            </React.Fragment>
          }
          avatar={
            <Avatar
              size="small"
              icon={this.state.expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
            />
          }
        />
      </List.Item>
    );

    const containsMultipleBatches = batches.length > 1;
    return (
      <React.Fragment>
        {containsMultipleBatches ? <GroupHeader /> : null}
        {this.state.expanded || !containsMultipleBatches
          ? batches.map((batch) => (
              <VersionEntry
                allowUpdate={allowUpdate}
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
