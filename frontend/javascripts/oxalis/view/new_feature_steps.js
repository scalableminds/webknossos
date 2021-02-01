// @flow
export default function getNewFeatureSteps(tour: Object) {
  const newFeatureSteps = [
    {
      id: 0,
      title: "Maximize Panes",
      text: "It is now possible to maximize a single pane.",
      attachTo: {
        element: ".lm_maximise",
        on: "bottom",
      },
      buttons: [
        {
          text: "Next",
          action: () => {
            this.setState({
              nodeContextMenuPosition: [200, 200],
              nodeContextMenuViewport: "PLANE_XY",
            });
            tour.next();
          },
        },
      ],
    },
    {
      id: 1,
      title: "The Context Menu",
      text:
        "By using Shift + Left Click you can open a context menu. This context menu offers function based on the currently active tool at the selected position.",
      attachTo: {
        element: ".node-context-menu",
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: () => {
            this.setState({
              nodeContextMenuPosition: null,
              nodeContextMenuViewport: null,
            });
            tour.back();
          },
        },
        {
          text: "Next",
          action: () => {
            this.setState({
              nodeContextMenuPosition: null,
              nodeContextMenuViewport: null,
            });
            tour.next();
          },
        },
      ],
    },
    {
      id: 1,
      title: "End",
      text:
        "This is the end. But stay tuned as your developers are already working on new awesome features of WebKnossos.",
      attachTo: {
        element: ".node-context-menu",
        on: "bottom",
      },
      buttons: [
        {
          text: "Back",
          action: () => {
            this.setState({
              nodeContextMenuPosition: [200, 200],
              nodeContextMenuViewport: "PLANE_XY",
            });
            tour.back();
          },
        },
        {
          text: "Next",
          action() {
            tour.next();
          },
        },
      ],
    },
  ];
  return newFeatureSteps;
}
