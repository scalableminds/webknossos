import { Dropdown, type MenuProps, Tag, Tree, type TreeProps } from "antd";
import { stringToAntdColorPreset } from "libs/format_utils";
import _ from "lodash";
import memoizeOne from "memoize-one";
import type { Vector3 } from "oxalis/constants";
import { updateTemporarySettingAction } from "oxalis/model/actions/settings_actions";
import { api } from "oxalis/singletons";
import Store from "oxalis/store";
import React from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import type { APIConnectomeFile } from "types/api_flow_types";
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
export type DirectionCaptionsKeys = keyof typeof directionCaptions;
export type Synapse = SrcSynapse | DstSynapse | SrcAndDstSynapse;
export type Agglomerate = Record<DirectionCaptionsKeys, Array<number>>;
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

const noneData: NoneData = {
  type: "none",
  id: 0,
};

function _convertConnectomeToTreeData(
  connectomeData: ConnectomeData | null | undefined,
): TreeData | undefined {
  if (connectomeData == null) return undefined;
  const { agglomerates, synapses } = connectomeData;

  const convertSynapsesForPartner = (
    synapseIds: null | number[],
    partnerId1: string,
    direction: DirectionCaptionsKeys,
  ): Array<TreeNode> => {
    if (synapseIds == null) return [];
    const partnerSynapses = synapseIds
      .map((synapseId) => synapses[synapseId]) // Some synapses might be filtered out
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

  return Object.keys(agglomerates).map((partnerId1: string) => ({
    key: `segment;${partnerId1};`,
    title: `Segment ${partnerId1}`,
    data: segmentData(+partnerId1, 0),
    children: Object.keys(agglomerates[+partnerId1]).map(
      // @ts-ignore TypeScript doesn't correctly infer the type of Object.keys, but assumes string instead
      (direction: DirectionCaptionsKeys) => ({
        key: `${direction};segment;${partnerId1};`,
        title: `${directionCaptions[direction]} Synapses`,
        data: noneData,
        children: convertSynapsesForPartner(
          agglomerates[+partnerId1][direction],
          partnerId1,
          direction,
        ),
        checkable: false,
        selectable: false,
      }),
    ),
  }));
}

export const convertConnectomeToTreeData = memoizeOne(_convertConnectomeToTreeData);
type State = {
  activeSegmentDropdownKey: string | null | undefined;
};
type Props = {
  checkedKeys: Array<string>;
  expandedKeys: Array<string>;
  onCheck: TreeProps<TreeNode>["onCheck"];
  onExpand: TreeProps<TreeNode>["onExpand"];
  onChangeActiveAgglomerateIds: (arg0: Array<number>) => void;
  connectomeData: ConnectomeData | null | undefined;
};

class SynapseTree extends React.Component<Props, State> {
  state: State = {
    activeSegmentDropdownKey: null,
  };

  handleSelect: TreeProps<TreeNode>["onSelect"] = (_selectedKeys, evt) => {
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
    Store.dispatch(updateTemporarySettingAction("hoveredSegmentId", agglomerateId || null));
  }

  createSegmentDropdownMenu = (agglomerateId: number): MenuProps => {
    return {
      items: [
        {
          key: "setActiveAgglomerateId",
          onClick: () => this.props.onChangeActiveAgglomerateIds([agglomerateId]),
          title: "Show All Synapses of This Segment",

          label: "Show All Synapses of This Segment",
        },
      ],
    };
  };

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
          <Dropdown
            menu={this.createSegmentDropdownMenu(data.id)}
            // AutoDestroy is used to remove the menu from DOM and keep up the performance.
            autoDestroy
            placement="bottom"
            open={this.state.activeSegmentDropdownKey === key}
            onOpenChange={(isVisible) => this.handleSegmentDropdownMenuVisibility(key, isVisible)}
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
          {({ height, width }) => (
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
                onSelect={this.handleSelect} // Although clicking on some nodes triggers an action, the node should not remain selected
                // as repeated clicks wouldn't retrigger the action, then
                selectedKeys={undefined}
                onCheck={onCheck}
                onExpand={onExpand}
                checkedKeys={checkedKeys}
                expandedKeys={expandedKeys}
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
