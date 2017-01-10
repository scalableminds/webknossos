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
    return this.listenTo(this, "change", _.debounce(
      () => { if (app.currentUser != null) { return this.save(); } },
      500));
  }

  getMouseInversionX() {
    return this.get("inverseX") ? 1 : -1;
  }


  getMouseInversionY() {
    return this.get("inverseY") ? 1 : -1;
  }


  getOrCreateBrightnessContrastColorSettings(model) {
    const settings = this.get("brightnessContrastColorSettings");
    const datasetSettings = settings[model.datasetPostfix] || {};

    for (const binary of model.getColorBinaries()) {
      datasetSettings[binary.name] = datasetSettings[binary.name] || {};
      _.defaults(datasetSettings[binary.name], settings.default);
    }

    return settings[model.datasetPostfix] = datasetSettings;
  }


  resetBrightnessContrastColorSettings(model) {
    return Request.receiveJSON("/user/configuration/default").then((defaultData) => {
      this.get("brightnessContrastColorSettings")[model.datasetPostfix] =
        defaultData.brightnessContrastColorSettings[model.datasetPostfix];

      return this.getOrCreateBrightnessContrastColorSettings(model);
    },
    );
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
