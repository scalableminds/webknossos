import _ from "lodash";
import backbone from "backbone";

class DatasetAccesslistCollection extends Backbone.Collection {

  constructor(datasetId) {
    super();
    // TODO (low): This line was before super in coffee, which is not allowed in
    // ES6. Check if this is ok respectively fix it.
    // Should be fine, since the super class is a backbone collection, which
    // shouldn't rely on this.url
    this.url = `/api/datasets/${datasetId}/accessList`;
  }
}

export default DatasetAccesslistCollection;
