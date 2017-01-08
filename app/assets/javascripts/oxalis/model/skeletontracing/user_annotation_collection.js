import _ from "lodash";
import Backbone from "backbone";

class UserAnnotationCollection extends Backbone.Collection {

  url() { return `/api/users/${this.userId}/annotations`; }

  initialize(models, options) {
    this.userId = options.userId;
    return this.dataSetName = options.dataSetName;
  }

  parse(response) {
    if (this.dataSetName) {
      return _.filter(response, { dataSetName: this.dataSetName });
    } else {
      return response;
    }
  }
}


export default UserAnnotationCollection;
