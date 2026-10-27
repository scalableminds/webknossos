// @vitest-environment jsdom
import { Row, type RowProps } from "antd";
import { act, createElement, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// global_mocks.ts replaces antd; the real Row is needed here.
vi.unmock("antd");

// Guards the antd patch in .yarn/patches (see #10277): antd's Row subscribes to
// breakpoint changes in a layout effect and re-rendered synchronously on every mount,
// even without responsive props. These nested sync updates contributed to
// "Maximum update depth exceeded" errors in the annotation view.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function countCommitsOnMount(props: RowProps): number {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let commitCount = 0;
  act(() => {
    root.render(
      createElement(
        Profiler,
        { id: "row", onRender: () => commitCount++ },
        createElement(Row, props),
      ),
    );
  });
  act(() => root.unmount());
  container.remove();
  return commitCount;
}

describe("antd Row breakpoint patch", () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = (query: string) =>
      ({
        matches: query.includes("min-width"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not re-render on mount without responsive props", () => {
    expect(
      countCommitsOnMount({ gutter: [16, 8], justify: "space-between", align: "middle" }),
    ).toBe(1);
  });

  it("still re-renders on mount with a responsive gutter", () => {
    expect(countCommitsOnMount({ gutter: { xs: 8, md: 16 } })).toBeGreaterThan(1);
  });
});
