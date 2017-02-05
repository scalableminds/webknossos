/**
 * dataset_configuration.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import NestedObjModel from "libs/nested_obj_model";

class DatasetConfiguration extends NestedObjModel {

  dataLayerNames: Array<string>;
  datasetName: string;

  initialize({ datasetName, dataLayerNames }) {
    this.dataLayerNames = dataLayerNames;
    this.datasetName = datasetName;
    this.listenTo(this, "change", _.debounce(
      () => { if (app.currentUser != null) { this.save(); } },
      500));
    this.listenTo(this, "sync", () => this.setDefaultBinaryColors());
  }


  url = () => `/api/dataSetConfigurations/${this.datasetName}`


  reset = () => this.setDefaultBinaryColors(true)


  triggerAll() {
    for (const property of Object.keys(this.attributes)) {
      this.trigger(`change:${property}`, this, this.get(property));
    }
  }


  setDefaultBinaryColors(forceDefault = false) {
    let defaultColors;
    let layer;
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
        contrast: 1,
      };

      if (forceDefault || !layers[layerName]) {
        layer = defaults;
      } else {
        layer = _.defaults(layers[layerName], defaults);
      }

      this.set(`layers.${layerName}`, layer);
    });
  }
}

export default DatasetConfiguration;
