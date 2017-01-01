import _ from "lodash";
import backbone from "backbone";

class DatasetAccesslistCollection extends Backbone.Collection {

  constructor(datasetId) {
    super();
    this.url = `/api/datasets/${datasetId}/accessList`;
  }
}

export default DatasetAccesslistCollection;
