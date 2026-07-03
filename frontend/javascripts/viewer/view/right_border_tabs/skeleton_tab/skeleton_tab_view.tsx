import { WarningOutlined } from "@ant-design/icons";
import { Divider, Empty, Modal, Spin, Tooltip } from "antd";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import DeleteGroupModalView from "../delete_group_modal_view";
import { useGroupOperations } from "./hooks/use_group_operations";
import { useSkeletonExport } from "./hooks/use_skeleton_export";
import { useSkeletonHierarchy } from "./hooks/use_skeleton_hierarchy";
import { useTreeSelection } from "./hooks/use_tree_selection";
import { SkeletonToolbar, skeletonTabId } from "./skeleton_toolbar";
import { SkeletonTreeView } from "./skeleton_tree_view";

function SkeletonsHiddenWarning() {
  const showSkeletons = useWkSelector(
    (state) => enforceSkeletonTracing(state.annotation).showSkeletons,
  );
  if (showSkeletons) {
    return null;
  }
  return (
    <Tooltip title={messages["tracing.skeletons_are_hidden_warning"]}>
      <WarningOutlined
        style={{
          color: "var(--ant-color-warning)",
        }}
      />
    </Tooltip>
  );
}

function ExportProgressModal({ pendingExport }: { pendingExport: "nml" | "csv" | null }) {
  return (
    <Modal
      open={pendingExport != null}
      title={pendingExport === "csv" ? "Preparing CSV" : "Preparing NML"}
      closable={false}
      footer={null}
      width={200}
      style={{
        textAlign: "center",
      }}
    >
      <Spin />
    </Modal>
  );
}

function SkeletonTabContent() {
  const hierarchy = useSkeletonHierarchy();
  const selection = useTreeSelection();
  const groupOperations = useGroupOperations(selection.deselectAllTrees);
  const skeletonExport = useSkeletonExport();
  const isEmpty = useWkSelector((state) => {
    const skeletonTracing = enforceSkeletonTracing(state.annotation);
    return skeletonTracing.trees.size() === 0 && skeletonTracing.treeGroups.length === 0;
  });

  return (
    <>
      <ExportProgressModal pendingExport={skeletonExport.pendingExport} />
      <SkeletonToolbar
        hierarchy={hierarchy}
        selection={selection}
        groupOperations={groupOperations}
        skeletonExport={skeletonExport}
      />
      <Divider size="small" />
      <SkeletonsHiddenWarning />
      {isEmpty ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              There are no trees in this annotation.
              <br /> A new tree will be created automatically once the first node is placed.
            </span>
          }
        />
      ) : (
        <ul
          style={{
            flex: "1 1 auto",
            overflow: "auto",
            margin: 0,
            padding: 0,
          }}
        >
          <SkeletonTreeView
            hierarchy={hierarchy}
            selection={selection}
            groupOperations={groupOperations}
          />
        </ul>
      )}
      {groupOperations.groupIdPendingDeletion != null ? (
        <DeleteGroupModalView
          onCancel={groupOperations.cancelGroupDeletion}
          onJustDeleteGroup={() => groupOperations.confirmGroupDeletion(false)}
          onDeleteGroupAndChildren={() => groupOperations.confirmGroupDeletion(true)}
        />
      ) : null}
    </>
  );
}

export default function SkeletonTabView() {
  const hasSkeletonTracing = useWkSelector((state) => state.annotation.skeleton != null);

  if (!hasSkeletonTracing) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          "This annotation does not contain a skeleton layer. You can add one in the Layers tab in the left sidebar."
        }
      />
    );
  }

  return (
    <div id={skeletonTabId} className="padded-tab-content" style={{ overflow: "hidden" }}>
      <DomVisibilityObserver targetId={skeletonTabId}>
        {(isVisibleInDom) => (isVisibleInDom ? <SkeletonTabContent /> : null)}
      </DomVisibilityObserver>
    </div>
  );
}
