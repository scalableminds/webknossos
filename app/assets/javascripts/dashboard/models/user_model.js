import _ from "lodash";
import Backbone from "backbone";

class UserModel extends Backbone.Model {
  static initClass() {
    this.prototype.defaults = {
      firstName: "",
      lastName: "",
    };
  }

  url() {
    let userID;
    if (userID = this.get("id")) {
      return `/api/users/${userID}`;
    } else {
      return "/api/user";
    }
  }


  initialize(options) {
    this.set("id", options.id);

    // If we don't have a user ID, there is nothing to do and we trigger the
    // right events to the keep the control flow going
    if (!this.get("id")) {
      return this.trigger("sync");
    }
  }
}
UserModel.initClass();

export default UserModel;
