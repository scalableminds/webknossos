import _ from "lodash";
import app from "app";
import Request from "libs/request";
import Backbone from "backbone";
import NestedObjModel from "libs/nested_obj_model";


class DatasetConfiguration extends NestedObjModel {

  constructor(...args) {
    super(...args);
    this.reset = this.reset.bind(this);
  }

  initialize({datasetName, dataLayerNames}) {

    this.dataLayerNames = dataLayerNames;
    this.url = `/api/dataSetConfigurations/${datasetName}`;
    this.listenTo(this, "change", _.debounce(
      () => { if (app.currentUser != null) { return this.save(); } },
      500));
    return this.listenTo(this, "sync", () => this.setDefaultBinaryColors());
  }


  reset() {

    return this.setDefaultBinaryColors(true);
  }


  triggerAll() {

    for (const property in this.attributes) {
      this.trigger(`change:${property}`, this, this.get(property));
    }
  }


  setDefaultBinaryColors(forceDefault) {

    let defaultColors;
    let layer;
    if (forceDefault == null) { forceDefault = false; }
    const layers = this.get("layers");

    if (this.dataLayerNames.length === 1) {
      defaultColors = [[255, 255, 255]];
    } else {
      defaultColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255],
                        [255, 255, 0], [0, 255, 255], [255, 0, 255]];
    }

    this.dataLayerNames.forEach((layerName, i) => {

      const defaults = {
        color: defaultColors[i % defaultColors.length],
        brightness: 0,
        contrast: 1
      };

      if (forceDefault || !layers[layerName]) {
        layer = defaults;
      } else {
        layer = _.defaults(layers[layerName], defaults);
      }

      this.set(`layers.${layerName}`, layer);
    })
  }
}

export default DatasetConfiguration;
