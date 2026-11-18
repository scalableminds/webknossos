// @vitest-environment jsdom
import { Tree as AntdTree, type GetRef } from "antd";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useTreeCursorOnSelection } from "viewer/view/right_border_tabs/segments_tab/hooks/use_tree_cursor_on_selection";
import { afterEach, describe, expect, it, vi } from "vitest";

// The global test setup mocks antd, but this test needs antd's real tree.
vi.unmock("antd");

// jsdom lacks matchMedia and ResizeObserver, which antd and its virtual list need.
vi.hoisted(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // @ts-expect-error React only enables act() in environments that declare it.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

type TreeInstance = GetRef<typeof AntdTree>;

// A long, virtualized list like the segment list. Only the rows at the top are rendered.
const treeData = Array.from({ length: 400 }, (_, index) => ({
  key: `segment-${index}`,
  title: `Segment ${index}`,
  isLeaf: true,
}));

function SegmentList({
  selectedKey,
  treeRef,
}: {
  selectedKey: string | null;
  treeRef: React.Ref<TreeInstance>;
}) {
  const treeCursor = useTreeCursorOnSelection(selectedKey);
  return createElement(AntdTree, {
    ref: treeRef,
    treeData,
    height: 200,
    itemHeight: 24,
    selectedKeys: selectedKey != null ? [selectedKey] : [],
    activeKey: treeCursor.activeKey,
    onActiveChange: treeCursor.onActiveChange,
  });
}

describe("Segment list cursor", () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  const renderList = (selectedKey: string | null) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const treeRef = createRef<TreeInstance>();
    const rerender = (key: string | null) =>
      act(() => root?.render(createElement(SegmentList, { selectedKey: key, treeRef })));
    rerender(selectedKey);
    // The tree scrolls to its active node via this (instance) method.
    const scrollTo = vi.fn();
    (treeRef.current as TreeInstance).scrollTo = scrollTo;
    return { container, scrollTo, rerender };
  };

  const moveMouseOverFirstRow = (container: HTMLElement) => {
    // The tree also renders a hidden .ant-tree-treenode outside of the list to measure indents.
    const row = container.querySelector(".ant-tree-list-holder .ant-tree-treenode");
    expect(row).not.toBeNull();
    act(() => {
      row?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
  };

  it("does not scroll back to the selected segment when the mouse moves over other rows", () => {
    // The selected segment is the last one, so the rows at the top are scrolled away from it.
    const { container, scrollTo } = renderList("segment-399");

    moveMouseOverFirstRow(container);
    moveMouseOverFirstRow(container);

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("moves the cursor to a newly selected segment", () => {
    const { container, scrollTo, rerender } = renderList("segment-399");
    moveMouseOverFirstRow(container);
    expect(container.querySelector(".ant-tree-treenode-active")).toBeNull();

    rerender("segment-1");

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ key: "segment-1" }));
    expect(container.querySelector(".ant-tree-treenode-active")?.textContent).toBe("Segment 1");
  });
});
