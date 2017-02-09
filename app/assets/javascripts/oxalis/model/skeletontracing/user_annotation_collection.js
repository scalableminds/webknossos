/**
 * user_annotation_collection.js
 * @flow weak
 */

import _ from "lodash";
import Backbone from "backbone";

class UserAnnotationCollection extends Backbone.Collection {

  userId: string;
  dataSetName: string;

  url() { return `/api/users/${this.userId}/annotations`; }

  initialize(models, options) {
    this.userId = options.userId;
    this.dataSetName = options.dataSetName;
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
