/**
 * user_annotations_collection.js
 * @flow weak
 */

import SortedCollection from "admin/models/sorted_collection";

class UserAnnotationsCollection extends SortedCollection {

  isFinished: boolean;
  userID: string;

  comparator = function comparator(a, b) {
    return b.get("created").localeCompare(a.get("created"));
  }


  url() {
    if (this.userID) {
      return `/api/users/${this.userID}/annotations?isFinished=${this.isFinished.toString()}`;
    } else {
      return `/api/user/annotations?isFinished=${this.isFinished.toString()}`;
    }
  }


  initialize(models, options) {
    this.isFinished = options.isFinished || false;
    this.userID = options.userID;
  }
}


export default UserAnnotationsCollection;
