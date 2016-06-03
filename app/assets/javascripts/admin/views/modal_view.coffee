_          = require("lodash")
Marionette = require("backbone.marionette")

class ModalView extends Marionette.LayoutView

  className : "modal fade"
  attributes :
    "tabindex" : "-1"
    "role" : "dialog"

  getTemplate : ->
    # Header, Body and Footer should be overwritten by parent class
    headerTemplate = @headerTemplate || @genericHeaderTemplate
    bodyTemplate = @bodyTemplate || @genericHeaderTemplate
    footerTemplate = @footerTemplate || @genericFooterTemplate

    executeIfFunction = (template) -> return if _.isFunction(template) then template() else template

    return @modalTemplate(
      headerTemplate : executeIfFunction(headerTemplate)
      bodyTemplate : executeIfFunction(bodyTemplate)
      footerTemplate : executeIfFunction(footerTemplate)
    )

  modalTemplate : _.template("""
    <div <!-- Root Element is required>
      <div class="modal-dialog">
        <div class="modal-content">
        <div class="modal-header">
          <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
          <%= headerTemplate %>
        </div>
        <div class="modal-body form-horizontal">
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

module.exports = ModalView
