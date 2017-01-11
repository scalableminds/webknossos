import _ from "lodash";
import Backbone from "backbone";
import app from "app";

class User extends Backbone.Model {
  static initClass() {
    this.prototype.url = "/api/user/userConfiguration";
  }
  // To add any user setting, you must define default values in
  // UserSettings.scala


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
    return (() => {
      const result = [];
      for (const property in this.attributes) {
        result.push(this.trigger(`change:${property}`, this, this.get(property)));
      }
      return result;
    })();
  }
}
User.initClass();

export default User;
