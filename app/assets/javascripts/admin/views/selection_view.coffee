### define
underscore : _
backbone.marionette : Marionette
./selection_item_view : SelectionItemView
###

class SelectionView extends Backbone.Marionette.CollectionView

  tagName : "select"
  className: "form-control"

  childView : SelectionItemView

  # keep track of the active option
  active : null

  initialize : (options) ->

    @collection.fetch(
      silent : true
      data : options.data
    ).done(
      => @render()
    )

    if options.name
      @$el.attr("name", options.name)

    # set active option
    if options.active
      @active = options.active

    # afterRender listener
    @listenTo(@, "render", @afterRender)

  afterRender : ->

    if @active?
      @$el.find("option[value=#{@active}]").attr("selected", "")
