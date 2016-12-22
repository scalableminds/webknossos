import Request from "libs/request";
import _ from "lodash";
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

    return (() => {
      const result = [];
      for (let property in this.attributes) {
        result.push(this.trigger(`change:${property}`, this, this.get(property)));
      }
      return result;
    })();
  }


  setDefaultBinaryColors(forceDefault) {

    let defaultColors;
    let defaults, layer;
    if (forceDefault == null) { forceDefault = false; }
    const layers = this.get("layers");

    if (this.dataLayerNames.length === 1) {
      defaultColors = [[255, 255, 255]];
    } else {
      defaultColors = [[255, 0, 0], [0, 255, 0], [0, 0, 255],
                        [255, 255, 0], [0, 255, 255], [255, 0, 255]];
    }

    return this.dataLayerNames.map((layerName, i) =>
      (defaults = {
        color: defaultColors[i % defaultColors.length],
        brightness: 0,
        contrast: 1
      },

      forceDefault || !layers[layerName] ?
        layer = defaults
      :
        layer = _.defaults(layers[layerName], defaults),

      this.set(`layers.${layerName}`, layer)));
  }
}

export default DatasetConfiguration;
