import { Empty, Space, Spin, type TreeProps } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useCallback, useState } from "react";
import { getVisibleOrLastSegmentationLayer } from "viewer/model/accessors/dataset_accessor";
import { setActiveConnectomeAgglomerateIdsAction } from "viewer/model/actions/connectome_actions";
import Store from "viewer/store";
import { mapAndFilterTreeData } from "viewer/view/right_border_tabs/connectome_tab/connectome_data_utils";
import ConnectomeHeader from "viewer/view/right_border_tabs/connectome_tab/connectome_header";
import useConnectomeData from "viewer/view/right_border_tabs/connectome_tab/hooks/use_connectome_data";
import useConnectomeSkeleton from "viewer/view/right_border_tabs/connectome_tab/hooks/use_connectome_skeleton";
import {
  useAgglomerateTreeSync,
  useSynapseTreeSync,
} from "viewer/view/right_border_tabs/connectome_tab/hooks/use_tree_sync";
import type {
  ConnectomeData,
  TreeNode,
} from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";
import SynapseTree, {
  convertConnectomeToTreeData,
} from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";

const connectomeTabId = "connectome-view";

function ConnectomeView() {
  // segmentationLayer will be the visible segmentation layer, or if there is none,
  // the segmentation layer that was last visible. This is done to allow toggling
  // the segmentation layer while browsing a connectome.
  const segmentationLayer = useWkSelector(getVisibleOrLastSegmentationLayer);
  const layerName = segmentationLayer?.name;

  const {
    connectomeData,
    availableSynapseTypes,
    checkedKeys,
    expandedKeys,
    isLoading,
    setCheckedKeys,
    setExpandedKeys,
    resetTreeData,
    currentConnectomeFile,
    activeAgglomerateIds,
  } = useConnectomeData(segmentationLayer);

  const [filteredConnectomeData, setFilteredConnectomeData] = useState<
    ConnectomeData | null | undefined
  >(null);

  const resetLocalState = useCallback(() => {
    resetTreeData();
    setFilteredConnectomeData(null);
  }, [resetTreeData]);

  useConnectomeSkeleton(layerName, resetLocalState);
  useSynapseTreeSync(layerName, filteredConnectomeData);
  useAgglomerateTreeSync(layerName, connectomeData, filteredConnectomeData, checkedKeys);

  const setActiveConnectomeAgglomerateIds = useCallback(
    (agglomerateIds: Array<bigint>) => {
      if (layerName == null) return;
      Store.dispatch(setActiveConnectomeAgglomerateIdsAction(layerName, agglomerateIds));
    },
    [layerName],
  );

  const handleReset = () => {
    setActiveConnectomeAgglomerateIds([]);
    resetLocalState();
  };

  const handleCheck: TreeProps<TreeNode>["onCheck"] = (checked, { node, checked: isChecked }) => {
    // The trailing ; is important to avoid matching 1234 if the id is 12
    const checkedNodeKeyPrefix = `segment;${node.data.id};`;
    // @ts-expect-error antd's <Tree> component uses objects instead of simple string if "checkable" prop is present
    const newCheckedKeys = checked.checked as string[];

    if (isChecked) {
      // Find out which keys should also be checked, because they represent the same agglomerate
      const treeData = convertConnectomeToTreeData(connectomeData) || [];
      const additionalCheckedKeys = Array.from(
        mapAndFilterTreeData(
          treeData,
          (treeNode) => treeNode.key,
          (treeNode) => treeNode.key.startsWith(checkedNodeKeyPrefix),
        ),
      );
      setCheckedKeys([...newCheckedKeys, ...additionalCheckedKeys]);
    } else {
      // Find out which keys should also be unchecked, because they represent the same agglomerate
      setCheckedKeys(newCheckedKeys.filter((key) => !key.startsWith(checkedNodeKeyPrefix)));
    }
  };

  const handleExpand: TreeProps<TreeNode>["onExpand"] = (newExpandedKeys) => {
    setExpandedKeys(newExpandedKeys as string[]);
  };

  const renderSynapseTreeContent = () => {
    if (currentConnectomeFile == null) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              No connectome file available for this segmentation layer.{" "}
              <a href="https://docs.webknossos.org/webknossos/connectome_viewer.html">
                Read more about this feature in the documentation.
              </a>
            </span>
          }
        />
      );
    } else if (isLoading) {
      return (
        <Space orientation="vertical" align="center" style={{ width: "100%", marginTop: 24 }}>
          <Spin size="large" />
          <span>Loading synapses…</span>
        </Space>
      );
    } else if (activeAgglomerateIds.length === 0 || filteredConnectomeData == null) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No segment(s) selected. Use the input field above to enter segment IDs or right-click on a segment and select 'Import Agglomerate and Synapses'."
        />
      );
    } else {
      return (
        <SynapseTree
          checkedKeys={checkedKeys}
          expandedKeys={expandedKeys}
          onCheck={handleCheck}
          onExpand={handleExpand}
          onChangeActiveAgglomerateIds={setActiveConnectomeAgglomerateIds}
          connectomeData={filteredConnectomeData}
        />
      );
    }
  };

  return (
    <div id={connectomeTabId} className="padded-tab-content">
      {segmentationLayer == null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No segmentation layer visible." />
      ) : (
        <>
          <ConnectomeHeader
            segmentationLayer={segmentationLayer}
            currentConnectomeFile={currentConnectomeFile}
            activeAgglomerateIds={activeAgglomerateIds}
            availableSynapseTypes={availableSynapseTypes}
            connectomeData={connectomeData}
            onUpdateFilteredConnectomeData={setFilteredConnectomeData}
            onSetActiveAgglomerateIds={setActiveConnectomeAgglomerateIds}
            onReset={handleReset}
          />
          {renderSynapseTreeContent()}
        </>
      )}
    </div>
  );
}

export default ConnectomeView;
