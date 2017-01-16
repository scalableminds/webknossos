/**
 * user_model.js
 * @flow weak
 */

import Backbone from "backbone";

class UserModel extends Backbone.Model {
  static initClass() {
    this.prototype.defaults = {
      firstName: "",
      lastName: "",
    };
  }

  url() {
    const userID = this.get("id");
    if (userID) {
      return `/api/users/${userID}`;
    }
    return "/api/user";
  }


  initialize(options) {
    this.set("id", options.id);

    // If we don't have a user ID, there is nothing to do and we trigger the
    // right events to the keep the control flow going
    if (!this.get("id")) {
      this.trigger("sync");
    }
  }
}
UserModel.initClass();

export default UserModel;
