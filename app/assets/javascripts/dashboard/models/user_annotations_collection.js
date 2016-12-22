import _ from "lodash";
import Backbone from "backbone";
import SortedCollection from "admin/models/sorted_collection";

class UserAnnotationsCollection extends SortedCollection {

  comparator(a, b) {
    return b.get("created").localeCompare(a.get("created"));
  }


  url() {
    if (this.userID) {
      return `/api/users/${this.userID}/annotations?isFinished=${this.isFinished}`;
    } else {
      return `/api/user/annotations?isFinished=${this.isFinished}`;
    }
  }


  initialize(models, options) {
    this.isFinished = options.isFinished || false;
    return this.userID = options.userID;
  }
}


export default UserAnnotationsCollection;
