// @vitest-environment jsdom

import type { InputHTMLAttributes, KeyboardEventHandler, ReactNode } from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveComment: vi.fn(),
}));

type MockInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: string | number;
  status?: string;
  onPressEnter?: KeyboardEventHandler<HTMLInputElement>;
};

vi.mock("antd", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    Input: React.forwardRef<HTMLInputElement, MockInputProps>(
      ({ onKeyDown, onPressEnter, status: _status, size: _size, ...props }, ref) =>
        React.createElement("input", {
          ...props,
          ref,
          onKeyDown: (event) => {
            onKeyDown?.(event);
            if (event.key === "Enter") {
              onPressEnter?.(event);
            }
          },
        }),
    ),
    Space: ({ children }: { children?: ReactNode }) => React.createElement("div", null, children),
  };
});

vi.mock("components/fast_tooltip", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    default: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("@ant-design/icons", () => ({ EditOutlined: () => null }));
vi.mock("libs/react_hooks", () => ({ useWkSelector: () => 1 }));
vi.mock("viewer/model/accessors/skeletontracing_accessor", () => ({
  getSkeletonTracing: vi.fn(),
}));
vi.mock("viewer/view/components/button_component", () => ({ default: () => null }));
vi.mock("viewer/view/components/markdown_modal", () => ({ MarkdownModal: () => null }));
vi.mock("viewer/view/right_border_tabs/comment_tab/hooks/use_active_comment", () => ({
  useActiveComment: () => ({ content: "" }),
}));
vi.mock("viewer/view/right_border_tabs/comment_tab/hooks/use_comment_edit_permission", () => ({
  useCommentEditPermission: () => ({ isDisabled: false, disabledReason: null }),
}));
vi.mock("viewer/view/right_border_tabs/comment_tab/hooks/use_comment_mutations", () => ({
  useCommentMutations: () => ({ saveComment: mocks.saveComment }),
}));

import { CommentEditor } from "viewer/view/right_border_tabs/comment_tab/comment_editor";

describe("CommentEditor", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onCommentCreated: () => void;

  beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
  });

  beforeEach(() => {
    mocks.saveComment.mockReset();
    onCommentCreated = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root.render(
        createElement(CommentEditor, {
          isMarkdownModalOpen: false,
          onOpenMarkdownModal: vi.fn(),
          onCloseMarkdownModal: vi.fn(),
          onCommentCreated,
        }),
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const typeComment = (input: HTMLInputElement) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setValue == null) {
      throw new Error("HTMLInputElement value setter is unavailable");
    }

    for (const value of ["a", "ab", "abc"]) {
      act(() => {
        setValue.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  };

  it.each([
    ["losing focus", (input: HTMLInputElement) => input.blur()],
    [
      "pressing Enter",
      (input: HTMLInputElement) =>
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    ],
  ])("batches typing until %s", (_description, finishEditing) => {
    const input = container.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Comment input was not rendered");
    }

    act(() => input.focus());
    typeComment(input);

    expect(mocks.saveComment).not.toHaveBeenCalled();
    expect(onCommentCreated).not.toHaveBeenCalled();

    act(() => finishEditing(input));

    expect(mocks.saveComment).toHaveBeenCalledTimes(1);
    expect(mocks.saveComment).toHaveBeenCalledWith("abc");
    expect(onCommentCreated).toHaveBeenCalledTimes(1);
  });

  it("does not save an unchanged comment on blur", () => {
    const input = container.querySelector("input");
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Comment input was not rendered");
    }

    act(() => {
      input.focus();
      input.blur();
    });

    expect(mocks.saveComment).not.toHaveBeenCalled();
    expect(onCommentCreated).not.toHaveBeenCalled();
  });
});
