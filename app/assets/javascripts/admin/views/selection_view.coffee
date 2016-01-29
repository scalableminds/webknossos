_                 = require("lodash")
Marionette        = require("backbone.marionette")
SelectionItemView = require("./selection_item_view")

class SelectionView extends Marionette.CollectionView

  tagName : "select"
  className: "form-control"

  childView : SelectionItemView

  # this view is often used as a subview
  # but has his specific collection model
  # parentModel allows to update the parent views model
  # with the selected option
  parentModel : null

  # keep track of the active option
  active : null

  events :
    "change" : "updateActive"

  initialize : (options) ->

    @collection.fetch(
      data : options.data
    )

    if options.name
      @$el.attr("name", options.name)

    # set active option
    if options.active
      @active = options.active

    # set parent model
    if options.parentModel
      @parentModel = options.parentModel

    # afterRender listener
    @listenTo(@, "render", @afterRender)


  afterRender : ->

    if @active?
      @$el.find("option[value=\"#{@active}\"]").attr("selected", "")
    else
      @active = @$el.val()

module.exports = SelectionView
