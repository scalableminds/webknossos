import type { CommentType, Tree } from "viewer/model/types/tree_types";
import {
  getCommentSorter,
  getSortedComments,
  getTreeSorter,
  SortByEnum,
} from "viewer/view/right_border_tabs/comment_tab/comment_sorting";
import { describe, expect, it } from "vitest";

// The sorters only access a subset of the Tree/Comment fields, so partial
// fixtures cast to the full type keep these tests focused and readable.
function makeComment(nodeId: number, content: string): CommentType {
  return { nodeId, content };
}

function makeTree(treeId: number, name: string, comments: CommentType[]): Tree {
  return { treeId, name, comments } as unknown as Tree;
}

describe("Comment Tab sorting", () => {
  describe("getCommentSorter", () => {
    it("sorts by nodeId ascending when sorting by ID", () => {
      const comments = [makeComment(3, "c"), makeComment(1, "a"), makeComment(2, "b")];
      const sorted = comments.slice().sort(getCommentSorter(SortByEnum.ID, true));
      expect(sorted.map((c) => c.nodeId)).toEqual([1, 2, 3]);
    });

    it("sorts by nodeId descending when sorting by ID", () => {
      const comments = [makeComment(3, "c"), makeComment(1, "a"), makeComment(2, "b")];
      const sorted = comments.slice().sort(getCommentSorter(SortByEnum.ID, false));
      expect(sorted.map((c) => c.nodeId)).toEqual([3, 2, 1]);
    });

    it("sorts by content when sorting by NAME", () => {
      const comments = [
        makeComment(1, "banana"),
        makeComment(2, "apple"),
        makeComment(3, "cherry"),
      ];
      const sorted = comments.slice().sort(getCommentSorter(SortByEnum.NAME, true));
      expect(sorted.map((c) => c.content)).toEqual(["apple", "banana", "cherry"]);
    });

    it("orders numeric suffixes numerically when sorting by NATURAL", () => {
      const comments = [makeComment(1, "item10"), makeComment(2, "item2"), makeComment(3, "item1")];
      const naturalSorted = comments.slice().sort(getCommentSorter(SortByEnum.NATURAL, true));
      expect(naturalSorted.map((c) => c.content)).toEqual(["item1", "item2", "item10"]);
    });
  });

  describe("getTreeSorter", () => {
    it("sorts by treeId when sorting by ID", () => {
      const trees = [makeTree(2, "b", []), makeTree(1, "a", []), makeTree(3, "c", [])];
      const sorted = trees.slice().sort(getTreeSorter(SortByEnum.ID, true));
      expect(sorted.map((t) => t.treeId)).toEqual([1, 2, 3]);
    });

    it("sorts by name when sorting by NAME", () => {
      const trees = [makeTree(1, "gamma", []), makeTree(2, "alpha", []), makeTree(3, "beta", [])];
      const sorted = trees.slice().sort(getTreeSorter(SortByEnum.NAME, true));
      expect(sorted.map((t) => t.name)).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  describe("getSortedComments", () => {
    it("flattens comments across trees and sorts within each tree", () => {
      const trees = [
        makeTree(1, "first", [makeComment(5, "e"), makeComment(1, "a")]),
        makeTree(2, "second", [makeComment(3, "c"), makeComment(2, "b")]),
      ];
      const flat = getSortedComments(trees, SortByEnum.ID, true);
      expect(flat.map((c) => c.nodeId)).toEqual([1, 5, 2, 3]);
    });

    it("does not mutate the original comment arrays", () => {
      const comments = [makeComment(2, "b"), makeComment(1, "a")];
      const trees = [makeTree(1, "first", comments)];
      getSortedComments(trees, SortByEnum.ID, true);
      expect(comments.map((c) => c.nodeId)).toEqual([2, 1]);
    });
  });
});
