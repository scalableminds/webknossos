_          = require("lodash")
Marionette = require("backbone.marionette")

class ModalView extends Marionette.View

  className : "modal fade"
  attributes :
    "tabindex" : "-1"
    "role" : "dialog"

  getTemplate : ->
    # Header, Body and Footer should be overwritten by parent class
    headerTemplate = @headerTemplate || @genericHeaderTemplate
    bodyTemplate = @bodyTemplate || @genericBodyTemplate
    footerTemplate = @footerTemplate || @genericFooterTemplate

    data = @serializeData()
    data = @mixinTemplateContext(data)

    executeIfFunction = (template) -> return if _.isFunction(template) then template(data) else template

    return @modalTemplate(
      headerTemplate : executeIfFunction(headerTemplate)
      bodyTemplate : executeIfFunction(bodyTemplate)
      footerTemplate : executeIfFunction(footerTemplate)
    )

  modalTemplate : _.template("""
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
    </div>
  """)

  genericHeaderTemplate : _.template("ModalHeader")
  genericBodyTemplate : _.template("ModalBody")
  genericFooterTemplate : _.template("""
    <a href="#" class="btn btn-default" data-dismiss="modal">Cancel</a>
  """)


  show : ->

    @$el.modal("show")


  hide : ->

    @$el.modal("hide")


  onRender : ->

    # Make sure the first input field always gets autofocused
    @$el.on('shown.bs.modal', =>
      @$el.find(".modal-body :input").first().focus()
    )


  destroy : ->

    @$el.off()

    # The event is neccesarry due to the 300ms CSS transition
    @$el.on("hidden.bs.modal", =>
      @$el.off("hidden.bs.modal")
      app.vent.trigger("modal:destroyed") #update pagination
    )
    @$el.modal("hide")

module.exports = ModalView
