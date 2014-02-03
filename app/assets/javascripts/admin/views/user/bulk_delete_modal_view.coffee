### define
underscore : _
backbone.marionette : marionette
###

class BulkDeleteModal extends Backbone.Marionette.ItemView

  tagName : "div"
  className : "modal hide fade"
  template : _.template("""
    <div class="modal-header">
      <button type="button" class="close" data-dismiss="modal" aria-hidden="true">&times;</button>
      <h3>Do you really want to delete these users?</h3>
    </div>
    <div class="modal-body">
      <fieldset data-validation-group>
        <button class="btn btn-danger modal-hide">Delete</button>
      </fieldset>
    </div>
  """)

  events :
    "click .modal-hide" : "bulkDeleteUsers"

  bulkDeleteUsers : ->

    #jquery tbody to exclude the "check all users" element
    $("tbody input[type=checkbox]:checked").each(
      (i, element) =>
        user = @collection.findWhere(
          id: $(element).val()
        )
        user.destroy()
    )

    @$el.modal("hide")

