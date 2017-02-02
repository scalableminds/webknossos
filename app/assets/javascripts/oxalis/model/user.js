import _ from "lodash";
import Backbone from "backbone";
import app from "app";

class User extends Backbone.Model {
  static initClass() {
    this.prototype.url = "/api/user/userConfiguration";
  }
  // To add any user setting, you must define default values in
  // UserConfiguration.scala


  initialize() {
    this.listenTo(this, "change", _.debounce(
      () => { if (app.currentUser != null) { this.save(); } },
      500));
  }

  getMouseInversionX() {
    return this.get("inverseX") ? 1 : -1;
  }


  getMouseInversionY() {
    return this.get("inverseY") ? 1 : -1;
  }


  triggerAll() {
    for (const property of Object.keys(this.attributes)) {
      this.trigger(`change:${property}`, this, this.get(property));
    }
  }
}
User.initClass();

export default User;
