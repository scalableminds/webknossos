// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import { AutoSizer } from "react-virtualized";
import { Dropdown, Menu, Tag, Tree } from "antd";
import React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";
import { stringToAntdColorPreset } from "libs/format_utils";
import api from "oxalis/api/internal_api";
import type { Vector3 } from "oxalis/constants";
import type { APIConnectomeFile } from "types/api_flow_types";
import Store from "oxalis/store";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
type BaseSynapse = {
  id: number;
  position: Vector3;
  type: string;
};
type SrcSynapse = BaseSynapse & {
  src: number;
  dst: void;
};
type DstSynapse = BaseSynapse & {
  src: void;
  dst: number;
};
type SrcAndDstSynapse = BaseSynapse & {
  src: number;
  dst: number;
};
export type Synapse = SrcSynapse | DstSynapse | SrcAndDstSynapse;
export type Agglomerate = {
  in?: Array<number>;
  out?: Array<number>;
};
export type ConnectomeData = {
  agglomerates: Record<number, Agglomerate>;
  synapses: Record<number, Synapse>;
  connectomeFile: APIConnectomeFile;
};
type SegmentData = {
  type: "segment";
  id: number;
  level: 0 | 1;
};
type SynapseData = {
  type: "synapse";
  id: number;
  position: Vector3;
  synapseType: string;
};
type NoneData = {
  type: "none";
  id: 0;
};
type TreeNodeData = SegmentData | SynapseData | NoneData;
export type TreeNode = {
  key: string;
  title: string;
  children: Array<TreeNode>;
  disabled?: boolean;
  selectable?: boolean;
  checkable?: boolean;
  data: TreeNodeData;
};
type TreeData = Array<TreeNode>;

export const directionCaptions = {
  in: "Incoming",
  out: "Outgoing",
};
const showLine = {
  showLeafIcon: false,
};
const contextMenuTrigger = ["contextMenu"];

const segmentData = (segmentId: number, level: 0 | 1): SegmentData => ({
  type: "segment",
  id: segmentId,
  level,
});

const synapseData = (synapseId: number, position: Vector3, type: string): SynapseData => ({
  type: "synapse",
  id: synapseId,
  position,
  synapseType: type,
});

const noneData = {
  type: "none",
  id: 0,
};

const _convertConnectomeToTreeData = (
  connectomeData: ConnectomeData | null | undefined,
): TreeData | null | undefined => {
  if (connectomeData == null) return null;
  const { agglomerates, synapses } = connectomeData;

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'synapseIds' implicitly has an 'any' typ... Remove this comment to see the full error message
  const convertSynapsesForPartner = (synapseIds, partnerId1, direction): Array<TreeNode> => {
    if (synapseIds == null) return [];
    const partnerSynapses = synapseIds
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'synapseId' implicitly has an 'any' type... Remove this comment to see the full error message
      .map((synapseId) => synapses[synapseId]) // Some synapses might be filtered out
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'synapse' implicitly has an 'any' type.
      .filter((synapse) => synapse != null);

    const synapsesByPartner = _.groupBy(partnerSynapses, direction === "in" ? "src" : "dst");

    return Object.keys(synapsesByPartner).map((partnerId2) => ({
      key: `segment;${partnerId2};${direction};${partnerId1};`,
      title: `Segment ${partnerId2}`,
      data: segmentData(+partnerId2, 1),
      children: synapsesByPartner[+partnerId2].map((synapse) => ({
        key: `synapse;${synapse.id};${direction};`,
        title: `Synapse ${synapse.id}`,
        data: synapseData(synapse.id, synapse.position, synapse.type),
        children: [],
        checkable: false,
      })),
    }));
  };

  // Build a nested tree structure with 4 levels.
  // First level are the active agglomerates, the user entered.
  // Second level is the distinction between Incoming and Outgoing synapses.
  // Third level are the respective partner agglomerates.
  // Fourth level are the respective synapses.
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ key: string; title: string; data: SegmentD... Remove this comment to see the full error message
  return Object.keys(agglomerates).map((partnerId1) => ({
    key: `segment;${partnerId1};`,
    title: `Segment ${partnerId1}`,
    data: segmentData(+partnerId1, 0),
    children: Object.keys(agglomerates[+partnerId1]).map((direction) => ({
      key: `${direction};segment;${partnerId1};`,
      // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      title: `${directionCaptions[direction]} Synapses`,
      data: noneData,
      children: convertSynapsesForPartner(
        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        agglomerates[+partnerId1][direction],
        partnerId1,
        direction,
      ),
      checkable: false,
      selectable: false,
    })),
  }));
};

export const convertConnectomeToTreeData = memoizeOne(_convertConnectomeToTreeData);
type State = {
  activeSegmentDropdownKey: string | null | undefined;
};
type Props = {
  checkedKeys: Array<string>;
  expandedKeys: Array<string>;
  onCheck: (
    arg0: {
      checked: Array<string>;
    },
    arg1: {
      node: TreeNode;
      checked: boolean;
    },
  ) => void;
  onExpand: (arg0: Array<string>) => void;
  onChangeActiveAgglomerateIds: (arg0: Array<number>) => void;
  connectomeData: ConnectomeData | null | undefined;
};

class SynapseTree extends React.Component<Props, State> {
  state: State = {
    activeSegmentDropdownKey: null,
  };

  handleSelect = (
    selectedKeys: Array<string>,
    evt: {
      selected: boolean;
      selectedNodes: Array<TreeNode>;
      node: TreeNode;
      event: string;
    },
  ) => {
    const { data } = evt.node;

    if (data.type === "synapse" && evt.selected) {
      api.tracing.setCameraPosition(data.position);
    }
  };

  handleSegmentDropdownMenuVisibility = (key: string, isVisible: boolean) => {
    if (isVisible) {
      this.setState({
        activeSegmentDropdownKey: key,
      });
      return;
    }

    this.setState({
      activeSegmentDropdownKey: null,
    });
  };

  setHoveredSegmentId(agglomerateId: number | null | undefined) {
    Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", agglomerateId));
  }

  createSegmentDropdownMenu = (agglomerateId: number) => (
    <Menu>
      <Menu.Item
        key="setActiveAgglomerateId"
        onClick={() => this.props.onChangeActiveAgglomerateIds([agglomerateId])}
        title="Show All Synapses of This Segment"
      >
        Show All Synapses of This Segment
      </Menu.Item>
    </Menu>
  );

  renderNode = (node: TreeNode) => {
    const { data, key } = node;
    if (data.type === "none") return node.title;

    if (data.type === "segment") {
      let title;

      // Do not show a dropdown menu for top-level segments
      if (data.level === 0) {
        title = node.title;
      } else {
        title = (
          <Dropdown // Lazily create the dropdown menu and destroy it again, afterwards
            overlay={() => this.createSegmentDropdownMenu(data.id)}
            autoDestroy
            placement="bottomCenter"
            visible={this.state.activeSegmentDropdownKey === key}
            onVisibleChange={(isVisible) =>
              this.handleSegmentDropdownMenuVisibility(key, isVisible)
            }
            // @ts-expect-error ts-migrate(2322) FIXME: Type 'string[]' is not assignable to type '("conte... Remove this comment to see the full error message
            trigger={contextMenuTrigger}
          >
            <span>{node.title}</span>
          </Dropdown>
        );
      }

      return (
        <span
          onMouseEnter={() => {
            this.setHoveredSegmentId(data.id);
          }}
          onMouseLeave={() => {
            this.setHoveredSegmentId(null);
          }}
        >
          {title}
        </span>
      );
    }

    // data.type === "synapse"
    return (
      <>
        {node.title}
        <Tag
          style={{
            marginLeft: 10,
            marginBottom: 0,
          }}
          color={stringToAntdColorPreset(data.synapseType)}
        >
          {data.synapseType}
        </Tag>
      </>
    );
  };

  render() {
    const { connectomeData, checkedKeys, expandedKeys, onCheck, onExpand } = this.props;
    return (
      <div
        style={{
          flex: "1 1 auto",
        }}
      >
        {/* Without the default height, height will be 0 on the first render, leading to tree virtualization being disabled.
         This has a major performance impact. */}
        <AutoSizer defaultHeight={500}>
          {({ height, width}: { height: number, width: number }) => (
            <div
              style={{
                height,
                width,
              }}
            >
              <Tree
                checkable
                checkStrictly
                height={height}
                showLine={showLine}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(selectedKeys: Array<string>, evt: {    sele... Remove this comment to see the full error message
                onSelect={this.handleSelect} // Although clicking on some nodes triggers an action, the node should not remain selected
                // as repeated clicks wouldn't retrigger the action, then
                // @ts-expect-error ts-migrate(2322) FIXME: Type 'null' is not assignable to type 'Key[] | und... Remove this comment to see the full error message
                selectedKeys={null}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(arg0: { checked: string[]; }, arg1: { node:... Remove this comment to see the full error message
                onCheck={onCheck}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(arg0: string[]) => void' is not assignable ... Remove this comment to see the full error message
                onExpand={onExpand}
                checkedKeys={checkedKeys}
                expandedKeys={expandedKeys}
                // @ts-expect-error ts-migrate(2322) FIXME: Type '(node: TreeNode) => string | JSX.Element' is... Remove this comment to see the full error message
                titleRender={this.renderNode}
                treeData={convertConnectomeToTreeData(connectomeData)}
              />
            </div>
          )}
        </AutoSizer>
      </div>
    );
  }
}

export default SynapseTree;
