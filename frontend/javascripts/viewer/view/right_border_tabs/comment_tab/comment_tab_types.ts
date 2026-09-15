import type { CommentType, Tree } from "viewer/model/types/tree_types";

export enum CommentSortMode {
  NAME = "NAME",
  ID = "ID",
  NATURAL = "NATURAL",
}

export type CommentSorting = {
  readonly mode: CommentSortMode;
  readonly isAscending: boolean;
};

/*
 * The rows of the comment tab are modelled as a discriminated union which antd's
 * <Tree> can consume directly (rendering happens via its titleRender prop).
 * Because each node carries the original domain object from the store, no
 * conversion between the antd representation and the store data is necessary
 * anywhere else in the tab.
 */
export type CommentRowNode = {
  readonly key: string;
  readonly type: "comment";
  readonly comment: CommentType;
  readonly isLeaf: true;
};

export type TreeRowNode = {
  readonly key: string;
  readonly type: "tree";
  readonly tree: Tree;
  readonly children: CommentRowNode[];
  readonly isLeaf: false;
};

export type CommentTabNode = TreeRowNode | CommentRowNode;

export const getTreeNodeKey = (treeId: number) => `tree-${treeId}`;
export const getCommentNodeKey = (nodeId: number) => `comment-${nodeId}`;
