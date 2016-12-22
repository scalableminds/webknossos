import _ from "lodash";
import backbone from "backbone";

class DatasetAccesslistCollection extends Backbone.Collection {

  constructor(datasetId) {
    this.url = `/api/datasets/${datasetId}/accessList`;
    super();
  }
}

export default DatasetAccesslistCollection;
