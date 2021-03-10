// @flow

import { OrthoViews } from "oxalis/constants";

const defaultLayout = {
  global: { splitterSize: 4, tabEnableRename: false, tabEnableClose: false, tabEnableDrag: true },
  borders: [
    {
      type: "border",
      location: "left",
      id: "left-sidebar",
      size: 400,
      barSize: 0.01,
      children: [
        {
          type: "tab",
          name: "container",
          id: "left-sidebar-tab-container",
          component: "sub",
          config: {
            model: {
              global: { tabSetEnableDivide: false, tabEnableClose: false },
              layout: {
                type: "row",
                weight: 100,
                children: [
                  {
                    type: "row",
                    weight: 100,
                    children: [
                      {
                        type: "tabset",
                        weight: 100,
                        selected: 1,
                        children: [
                          {
                            type: "tab",
                            name: "Annotation",
                            component: "settings-tab",
                            id: "UserSettingsView",
                          },
                          {
                            type: "tab",
                            name: "Dataset",
                            component: "settings-tab",
                            id: "DatasetSettingsView",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    },
    {
      type: "border",
      location: "right",
      id: "right-sidebar",
      barSize: 0.01,
      size: 400,
      children: [
        {
          type: "tab",
          name: "container",
          id: "right-sidebar-tab-container",
          component: "sub",
          config: {
            model: {
              global: { tabSetEnableDivide: false, tabEnableClose: false },
              layout: {
                type: "row",
                weight: 100,
                children: [
                  {
                    type: "row",
                    weight: 50,
                    children: [
                      {
                        type: "tabset",
                        weight: 50,
                        selected: 0,
                        children: [
                          {
                            type: "tab",
                            name: "DatasetInfoTabView",
                            component: "tab",
                            id: "DatasetInfoTabView",
                          },
                          {
                            type: "tab",
                            name: "TreesTabView",
                            component: "tab",
                            id: "TreesTabView",
                          },
                          {
                            type: "tab",
                            name: "CommentTabView",
                            component: "tab",
                            id: "CommentTabView",
                          },
                        ],
                      },
                      {
                        type: "tabset",
                        weight: 50,
                        selected: 0,
                        children: [
                          {
                            type: "tab",
                            name: "MappingInfoView",
                            component: "tab",
                            id: "MappingInfoView",
                          },
                          {
                            type: "tab",
                            name: "MeshesView",
                            component: "tab",
                            id: "MeshesView",
                          },
                          {
                            type: "tab",
                            name: "AbstractTreeTabView",
                            component: "tab",
                            id: "AbstractTreeTabView",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    },
  ],
  layout: {
    type: "row",
    weight: 100,
    children: [
      {
        type: "row",
        weight: 50,
        children: [
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [
              {
                type: "tab",
                name: OrthoViews.PLANE_XY,
                component: "viewport",
                id: OrthoViews.PLANE_XY,
              },
            ],
          },
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [
              {
                type: "tab",
                name: OrthoViews.PLANE_XZ,
                component: "viewport",
                id: OrthoViews.PLANE_XZ,
              },
            ],
          },
        ],
      },
      {
        type: "row",
        weight: 50,
        children: [
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [
              {
                type: "tab",
                name: OrthoViews.PLANE_YZ,
                component: "viewport",
                id: OrthoViews.PLANE_YZ,
              },
            ],
          },
          {
            type: "tabset",
            weight: 50,
            selected: 0,
            children: [
              {
                type: "tab",
                name: OrthoViews.TDView,
                component: "viewport",
                id: OrthoViews.TDView,
              },
            ],
          },
        ],
      },
    ],
  },
};

export default defaultLayout;
