import _ from "lodash";
import backbone from "backbone";

class DatasetAccesslistCollection extends Backbone.Collection {

  constructor(datasetId) {
    super();
    // TODO: This line was before super in coffee, which is not allowed in
    // ES6. Check if this is ok respectively fix it.
    this.url = `/api/datasets/${datasetId}/accessList`;
  }
}

export default DatasetAccesslistCollection;
