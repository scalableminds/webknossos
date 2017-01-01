import Marionette from "backbone.marionette";

class HoverShowHideBehavior extends Marionette.Behavior {
  static initClass() {
  
    this.prototype.events  = {
      "mouseenter .hover-dynamic" : "mouseEnter",
      "mouseleave .hover-dynamic" : "mouseLeave",
      "blur .hover-dynamic .hover-input" : "blur"
    };
  }

  mouseLeave() {

    if (!this.$(".hover-input:focus").length) {
      this.$(".hover-show").addClass("hide");
      return this.$(".hover-hide").removeClass("hide");
    }
  }


  mouseEnter() {

    this.$(".hover-show").removeClass("hide");
    return this.$(".hover-hide").addClass("hide");
  }


  blur(evt) {

    return window.setTimeout(
      () => {
        this.$(evt.target).parents(".hover-dynamic").find(".hover-show").addClass("hide");
        return this.$(evt.target).parents(".hover-dynamic").find(".hover-hide").removeClass("hide");
      }
      , 200);
  }
}
HoverShowHideBehavior.initClass();

export default HoverShowHideBehavior;
