import SettingsView from "./settings_view";
import ControlsCategoryView from "../category_views/controls_category_view";
import ViewportCategoryView from "../category_views/viewport_category_view";
import TDViewCategoryView from "../category_views/tdview_category_view";
import IsosurfaceCategoryView from "../category_views/isosurface_category_view";
import SegmentationCategoryView from "../category_views/segmentation_category_view";
import AbstractTreeCategoryView from "../category_views/abstracttree_category_view";

class PlaneUserSettingsView extends SettingsView {
  static initClass() {
  
  
    this.prototype.id  = "user-settings";
    this.prototype.className  = "flex-column";
  
  
    this.prototype.subviewCreatorsList  = [
      [
        "controls-category", function() {
          return new ControlsCategoryView({model : this.model.get("user")});
        }
      ],
  
      [
        "viewport-category", function() {
          return new ViewportCategoryView({model: this.model});
        }
      ],
  
      [
        "tdview-category", function() {
          return new TDViewCategoryView({model : this.model.get("user")});
        }
      ],
  
      [
        "isosurface-category", function() {
          return new IsosurfaceCategoryView({model : this.model.get("user")});
        }
      ],
  
      [
        "segmentation-category", function() {
          return new SegmentationCategoryView({model : this.model.get("user")});
        }
      ],
  
      [
        "abstracttree-category", function() {
          return new AbstractTreeCategoryView({model : this.model.get("user")});
        }
      ]
    ];
  }
}
PlaneUserSettingsView.initClass();

export default PlaneUserSettingsView;
