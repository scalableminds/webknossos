import type { TreeGroup } from "viewer/model/types/tree_types";

export const SEGMENT_GROUPS: TreeGroup[] = [
  {
    name: "subroot1",
    groupId: 1,
    children: [
      {
        name: "subsubroot1",
        groupId: 3,
        children: [
          {
            name: "subsubsubroot1",
            groupId: 4,
            children: [],
          },
        ],
      },
    ],
  },
  {
    name: "subroot2",
    groupId: 2,
    children: [],
  },
];

export const SEGMENT_GROUPS_EDITED: TreeGroup[] = [
  {
    name: "subroot1 - renamed",
    groupId: 1,
    children: [],
  },
  {
    name: "subroot2",
    groupId: 2,
    children: [
      {
        name: "subsubroot1",
        groupId: 3,
        children: [],
      },
    ],
  },
];

export const MOVE_GROUP_EDGE_CASE = {
  BEFORE: [
    {
      name: "subroot1",
      groupId: 1,
      isExpanded: false,
      children: [
        {
          name: "subsubroot1",
          groupId: 3,
          isExpanded: false,
          children: [
            {
              name: "subsubsubroot1",
              groupId: 4,
              isExpanded: false,
              children: [],
            },
          ],
        },
        {
          name: "some group",
          groupId: 2,
          isExpanded: false,
          children: [],
        },
      ],
    },
  ],
  AFTER: [
    {
      name: "subsubroot1",
      groupId: 3,
      isExpanded: false,
      children: [
        {
          name: "subsubsubroot1",
          groupId: 4,
          isExpanded: false,
          children: [],
        },
        {
          name: "subroot1",
          groupId: 1,
          isExpanded: false,
          children: [
            {
              name: "some group",
              groupId: 2,
              isExpanded: false,
              children: [],
            },
          ],
        },
      ],
    },
  ],
};

export const SWAP_GROUP_EDGE_CASE = {
  BEFORE: [
    {
      name: "subroot1",
      groupId: 1,
      isExpanded: false,
      children: [
        {
          name: "subsubroot1",
          groupId: 3,
          isExpanded: false,
          children: [
            {
              name: "subsubsubroot1",
              groupId: 4,
              isExpanded: false,
              children: [],
            },
          ],
        },
        {
          name: "some group",
          groupId: 2,
          isExpanded: false,
          children: [],
        },
      ],
    },
  ],
  AFTER: [
    {
      name: "some group",
      groupId: 2,
      isExpanded: false,

      children: [
        {
          name: "subsubroot1",
          groupId: 3,
          isExpanded: false,
          children: [
            {
              name: "subsubsubroot1",
              groupId: 4,
              isExpanded: false,
              children: [],
            },
          ],
        },
        {
          name: "subroot1",
          groupId: 1,
          isExpanded: false,
          children: [],
        },
      ],
    },
  ],
};
