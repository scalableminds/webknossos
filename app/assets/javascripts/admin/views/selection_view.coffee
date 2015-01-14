### define
underscore : _
backbone.marionette : Marionette
./selection_item_view : SelectionItemView
###

class SelectionView extends Backbone.Marionette.CollectionView

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

    console.log("active", @active)


  ###*
   * Return the active option.
   *
   * @method getActive
   * @return {String} active option's value
   ###
  getActive : ->

    return @active

  updateActive : (evt) ->

    @active = evt.target.value
    return

  ###*
   * Update the parent views model with the selected option
   *
   * @method updateModel
   ###
  updateModel : ->

    # TODO: remove
    console.log('parentModel', @$el.attr("name"), @parentModel)

    if @parentModel?
      @parentModel.set(@$el.attr("name"), @getActive())

    return
