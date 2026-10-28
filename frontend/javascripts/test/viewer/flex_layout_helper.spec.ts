import { Actions, type IJsonModel, Model } from "flexlayout-react";
import { getTabsetIdToToggleMaximize } from "viewer/view/layouting/flex_layout_helper";
import { describe, expect, it } from "vitest";

const viewportTabset = (id: string, viewportIds: string[]) => ({
  type: "tabset" as const,
  id,
  children: viewportIds.map((viewportId) => ({
    type: "tab" as const,
    id: viewportId,
    component: "viewport",
  })),
});

const orthoLayout: IJsonModel = {
  global: {},
  borders: [],
  layout: {
    type: "row",
    children: [
      {
        type: "row",
        children: [
          viewportTabset("xy-tabset", ["PLANE_XY"]),
          viewportTabset("xz-tabset", ["PLANE_XZ"]),
        ],
      },
      {
        type: "row",
        children: [
          viewportTabset("yz-tabset", ["PLANE_YZ"]),
          viewportTabset("td-tabset", ["TDView"]),
        ],
      },
    ],
  },
};

const flightLayout: IJsonModel = {
  global: {},
  borders: [],
  layout: {
    type: "row",
    children: [viewportTabset("flight-tabset", ["flightViewport"])],
  },
};

describe("getTabsetIdToToggleMaximize", () => {
  it("should return the tabset of the hovered viewport instead of the focused one", () => {
    const model = Model.fromJson(orthoLayout);
    model.doAction(Actions.setActiveTabset("xy-tabset"));

    expect(getTabsetIdToToggleMaximize(model, "TDView")).toBe("td-tabset");
    expect(getTabsetIdToToggleMaximize(model, "PLANE_YZ")).toBe("yz-tabset");
  });

  it("should return the maximized tabset so that it gets restored", () => {
    const model = Model.fromJson(orthoLayout);
    model.doAction(Actions.maximizeToggle("xz-tabset"));

    expect(getTabsetIdToToggleMaximize(model, "TDView")).toBe("xz-tabset");
  });

  it("should fall back to the flight viewport if the hovered viewport is not part of the layout", () => {
    const model = Model.fromJson(flightLayout);

    expect(getTabsetIdToToggleMaximize(model, "PLANE_XY")).toBe("flight-tabset");
  });
});
