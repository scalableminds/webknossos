import Marionette from "backbone.marionette";
import _ from "lodash";
import SettingsView from "./settings_view";
import TreeCategoryView from "../category_views/tree_category_view";
import NodeCategoryView from "../category_views/node_category_view";
import BoundingBoxCategory from "../category_views/bounding_box_category_view";

class SkeletonTracingSettingsView extends SettingsView {
  static initClass() {
  
  
    this.prototype.id  = "tracing-settings";
    this.prototype.className  = "flex-column";
  
    this.prototype.modelName  = "skeletonTracingAdapter";
  
    this.prototype.subviewCreatorsList  = [
      [
        "tree-category", function() {
          return new TreeCategoryView({ model: this.model });
        }
      ],
  
      [
        "node-category", function() {
          return new NodeCategoryView({ model: this.model });
        }
      ],
  
      [
        "boundingBox-category", function() {
          return new BoundingBoxCategory({ model: this.model });
        }
      ]
    ];
  }
}
SkeletonTracingSettingsView.initClass();

export default SkeletonTracingSettingsView;
