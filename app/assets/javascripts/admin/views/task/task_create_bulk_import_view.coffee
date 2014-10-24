### define
underscore : _
backbone.marionette : marionette
routes : routes
###

class TaskCreateBulkImportView extends Backbone.Marionette.ItemView

  id : "create-bulk-import"
  template : _.template("""
    <!-- PUT BULK IMPORT FROM HERE // disable auto-submission -->
  """)

  #events :
    # put submit event here


  ###*
    * Submit form data as json.
    *
    * @method submit
    ###
  submit : ->

    # trigger ajax
