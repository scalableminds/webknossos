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
    </div>
    <div class="modal-footer">
      <button class="btn btn-danger modal-hide">Delete</button>
      <a href="#" class="btn" data-dismiss="modal">Cancel</a>
    </div>
  """)

  events :
    "click .modal-hide" : "bulkDeleteUsers"


  initialize : (args) ->

    @userCollection = args.userCollection


  bulkDeleteUsers : ->

    #jquery tbody to exclude the "check all users" element
    $("tbody input[type=checkbox]:checked").each(
      (i, element) =>
        user = @userCollection.findWhere(
          id: $(element).val()
        )
        user.destroy()
    )

    @$el.modal("hide")

