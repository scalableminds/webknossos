import _ from "lodash";
import NestedObjModel from "libs/nested_obj_model";
import moment from "moment";

class DatasetModel extends NestedObjModel {
  static initClass() {
    this.prototype.urlRoot = "/api/datasets";
    this.prototype.idAttribute = "name";
  }

  parse(response) {
    // since defaults doesn't override null...
    if (response.dataSource === null) {
      response.dataSource = {
        needsImport: true,
        baseDir: "",
        scale: [],
        dataLayers: [],
      };
    }

    response.hasSegmentation = _.some(response.dataSource.dataLayers,
      layer => layer.category === "segmentation");

    response.thumbnailURL = this.createThumbnailURL(response.name, response.dataSource.dataLayers);

    response.formattedCreated = moment(response.created).format("YYYY-MM-DD HH:mm");

    return response;
  }


  createThumbnailURL(datasetName, layers) {
    const colorLayer = _.find(layers, { category: "color" });
    if (colorLayer) {
      return `/api/datasets/${datasetName}/layers/${colorLayer.name}/thumbnail`;
    }
    return "";
  }
}
DatasetModel.initClass();

export default DatasetModel;
