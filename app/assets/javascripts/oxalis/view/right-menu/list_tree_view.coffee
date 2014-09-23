### define
underscore : _
app : app
backbone.marionette : marionette
./list_tree_item_view : ListTreeItemView
###

class ListTreeView extends Backbone.Marionette.CompositeView

  id : "tree-navbar"
  template : _.template("""
    <div>
      <div class="btn-group">
        <button class="btn btn-default" id="tree-create-button"><i class="fa fa-plus"></i>Create tree</button>
        <button class="btn btn-default" id="tree-delete-button"><i class="fa fa-trash-o"></i>Delete tree</button>
      </div>
      <div class="btn-group pull-right">
        <button class="btn btn-default" id="tree-color-shuffle" title="Change color"><i class="fa fa-adjust"></i></button>
        <button class="btn btn-default" id="tree-color-shuffle-all" title="Shuffle all Colors"><i class="fa fa-random"></i></button>
        <button class="btn btn-default dropdown-toggle" data-toggle="dropdown" id="tree-sort-button" title="Sort">
          <i class="fa fa-sort-alpha-asc"></i>
        </button>
        <ul class="dropdown-menu pull-right" id="tree-sort">
          <li>
            <a href="#" data-sort="name">by name
              <i class="fa fa-check" id="sort-name-icon"></i>
            </a>
          </li>
          <li>
            <a href="#" data-sort="time">by creation time
              <i class="fa fa-check" id= "sort-time-icon"></i>
            </a>
          </li>
        </ul>
      </div>
    </div>
    <div class="input-group">
      <span class="input-group-btn">
        <button class="btn btn-default" id="tree-prev-button"><i class="fa fa-arrow-left"></i></button>
      </span>
      <input name="name" id="tree-name-input" class="form-control" maxlength="30" type="text" autocomplete="off">
      <span class="input-group-btn">
        <button class="btn btn-default" id="tree-next-button"><i class="fa fa-arrow-right"></i></button>
      </span>
    </div>
    <ul id="tree-list"></ul>
    """)

  childView : ListTreeItemView
  childViewContainer : "ul#tree-list"
  childViewOptions : ->
    parent : @
    activeTreeId : @getActiveTree().treeId


  events :
    "change #tree-name-input" : "setTreeName"
    "click #tree-prev-button" : "selectPreviousTree"
    "click #tree-next-button" : "selectNextTree"
    "click #tree-create-button" : "createNewTree"
    "click #tree-delete-button" : "deleteTree"
    "click #tree-color-shuffle" : "shuffleTreeColor"
    "click #tree-color-shuffle-all" : "shuffleAllTreeColors"
    "click a[data-sort]" : "sortTrees"

  ui :
    "treeNameInput" : "#tree-name-input"
    "sortNameIcon" : "#sort-name-icon"
    "sortTimeIcon" : "#sort-time-icon"


  initialize : (options) ->

    {@_model} = options

    @listenTo(app.vent, "model:sync", @refresh)
    @listenTo(app.vent, "model:sync", ->

      @updateSortIndicator()

      @listenTo(@_model.skeletonTracing, "deleteTree", @refresh)
      @listenTo(@_model.skeletonTracing, "mergeTree", @refresh)
      @listenTo(@_model.skeletonTracing, "newTree", @refresh)
      @listenTo(@_model.skeletonTracing, "newTreeName", @refresh)
      @listenTo(@_model.skeletonTracing, "reloadTrees", @refresh)
      @listenTo(@_model.skeletonTracing, "deleteActiveNode", @updateTreesDebounced)
      @listenTo(@_model.skeletonTracing, "newNode", @updateTreesDebounced)
      @listenTo(@_model.skeletonTracing, "newTreeColor", @updateTreesDebounced)
      @listenTo(@_model.skeletonTracing, "newActiveTree", @updateTreesDebounced)
      @listenTo(@_model.skeletonTracing, "newActiveNode", @_renderChildren)
    )


  setTreeName : (evt) ->
    @_model.skeletonTracing.setTreeName(evt.target.value)


  selectPreviousTree : ->
    @selectNextTree(false)


  selectNextTree : ->
    @selectNextTree(true)


  createNewTree : ->
    @_model.skeletonTracing.createNewTree()


  deleteTree : ->
    @_model.skeletonTracing.deleteTree(true)


  shuffleTreeColor : ->
    @_model.skeletonTracing.shuffleTreeColor()


  shuffleAllTreeColors : ->
    @_model.skeletonTracing.shuffleAllTreeColors()


  sortTrees : (evt) ->
    evt.preventDefault()
    @_model.user.set("sortTreesByName", ($(evt.currentTarget).data("sort") == "name"))

    @refresh()
    @updateSortIndicator()


  updateSortIndicator : ->

    isSortedByName = @_model.user.get("sortTreesByName")
    @ui.sortNameIcon.toggle(isSortedByName)
    @ui.sortTimeIcon.toggle(!isSortedByName)


  selectNextTree : (next) ->

    @_model.skeletonTracing.selectNextTree(next)
    @_model.skeletonTracing.centerActiveNode()
    @updateName()


  getActiveTree : ->

    return @_model.skeletonTracing.getTree()


  refresh : ->

    trees = @_model.skeletonTracing.getTreesSorted()
    @collection = new Backbone.Collection(trees)

    @updateTreesDebounced()


  updateName : ->

      name = @getActiveTree().name
      @ui.treeNameInput.val(name)


  updateTreesDebounced : ->
    # avoid lags caused by frequent DOM modification

    @updateTreesDebounced = _.debounce(
      =>
        @updateName()
        @_renderChildren()
      200
    )
    @updateTreesDebounced()

    # animate scrolling to the new tree
    # $("#tree-list").animate({
    #   scrollTop: newIcon.offset().top - $("#tree-list").offset().top + $("#tree-list").scrollTop()}, 250)


  setActiveTree : (treeId) ->

    @_model.skeletonTracing.setActiveTree(treeId)
    @_model.skeletonTracing.centerActiveNode()
