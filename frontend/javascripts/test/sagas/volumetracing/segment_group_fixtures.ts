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
