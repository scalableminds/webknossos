import SettingsView from "./settings_view";
import ControlsCategoryView from "../category_views/controls_category_view";
import FlightCategoryView from "../category_views/flight_category_view";

class ArbitraryUserSettingsView extends SettingsView {
  static initClass() {
  
  
    this.prototype.id  = "user-settings";
    this.prototype.className  = "flex-column";
  
  
    this.prototype.modelName  = "user";
  
  
    this.prototype.subviewCreatorsList  = [
      [
        "controls-category", function() {
  
          return new ControlsCategoryView({model : this.model});
        }
      ],
  
      [
        "flight-category", function() {
  
          return new FlightCategoryView({model : this.model});
        }
      ]
    ];
  }
}
ArbitraryUserSettingsView.initClass();

export default ArbitraryUserSettingsView;
