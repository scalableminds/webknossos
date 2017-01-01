import _ from "lodash";
import Marionette from "backbone.marionette";

class ModalView extends Marionette.View {
  static initClass() {
  
    this.prototype.className  = "modal fade";
    this.prototype.attributes  = {
      "tabindex" : "-1",
      "role" : "dialog"
    };
  
    this.prototype.modalTemplate  = _.template(`\
<div>
  <!-- Root 'div' is required -->
  <div class="modal-dialog">
    <div class="modal-content">
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <%= headerTemplate %>
    </div>
    <div class="modal-body container-fluid">
      <%= bodyTemplate %>
    </div>
    <div class="modal-footer">
      <%= footerTemplate %>
    </div>
  </div>
</div>\
`);
  
    this.prototype.genericHeaderTemplate  = _.template("ModalHeader");
    this.prototype.genericBodyTemplate  = _.template("ModalBody");
    this.prototype.genericFooterTemplate  = _.template(`\
<a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>\
`);
  }

  getTemplate() {
    // Header, Body and Footer should be overwritten by parent class
    const headerTemplate = this.headerTemplate || this.genericHeaderTemplate;
    const bodyTemplate = this.bodyTemplate || this.genericBodyTemplate;
    const footerTemplate = this.footerTemplate || this.genericFooterTemplate;

    let data = this.serializeData();
    data = this.mixinTemplateContext(data);

    const executeIfFunction = template => _.isFunction(template) ? template(data) : template;

    return this.modalTemplate({
      headerTemplate : executeIfFunction(headerTemplate),
      bodyTemplate : executeIfFunction(bodyTemplate),
      footerTemplate : executeIfFunction(footerTemplate)
    });
  }


  show() {

    return this.$el.modal("show");
  }


  hide() {

    return this.$el.modal("hide");
  }


  onRender() {

    // Make sure the first input field always gets autofocused
    return this.$el.on('shown.bs.modal', () => {
      return this.$el.find(".modal-body :input").first().focus();
    }
    );
  }


  destroy() {

    this.$el.off();

    // The event is neccesarry due to the 300ms CSS transition
    this.$el.on("hidden.bs.modal", () => {
      this.$el.off("hidden.bs.modal");
      return app.vent.trigger("modal:destroyed");
    } //update pagination
    );
    return this.$el.modal("hide");
  }
}
ModalView.initClass();

export default ModalView;
