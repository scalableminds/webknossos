_                = require("lodash")
app              = require("app")
Marionette       = require("backbone.marionette")
Backbone         = require("backbone")
ListTreeItemView = require("./list_tree_item_view")

class ListTreeView extends Marionette.CompositeView

  id : "tree-navbar"
  className : "flex-column"
  template : _.template("""
    <div>
      <div class="btn-group">
        <button class="btn btn-default" id="tree-create-button"><i class="fa fa-plus"></i>Create tree</button>
        <button class="btn btn-default" id="tree-delete-button"><i class="fa fa-trash-o"></i>Delete tree</button>
      </div>
      <div class="btn-group pull-right">
        <button class="btn btn-default" id="tree-color-shuffle" title="Change color"><i class="fa fa-adjust"></i>Change Color</button>
        <button class="btn btn-default" id="tree-color-shuffle-all" title="Shuffle all Colors"><i class="fa fa-random"></i>Shuffle Colors</button>
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
    <ul id="tree-list" class="flex-overflow"></ul>
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

    @collection = new Backbone.Collection()

    @listenTo(@, "render", @updateSortIndicator)
    @refresh()

    @listenTo(@model.skeletonTracing, "deleteTree", @refresh)
    @listenTo(@model.skeletonTracing, "mergeTree", @refresh)
    @listenTo(@model.skeletonTracing, "newTree", @refresh)
    @listenTo(@model.skeletonTracing, "newTreeName", @refresh)
    @listenTo(@model.skeletonTracing, "reloadTrees", @refresh)
    @listenTo(@model.skeletonTracing, "deleteActiveNode", @updateTreesDebounced)
    @listenTo(@model.skeletonTracing, "newNode", @updateTreesDebounced)
    @listenTo(@model.skeletonTracing, "newTreeColor", @refresh)
    @listenTo(@model.skeletonTracing, "newActiveTree", @updateTreesDebounced)
    @listenTo(@model.skeletonTracing, "newActiveNode", @_renderChildren)


  setTreeName : (evt) ->
    @model.skeletonTracing.setTreeName(evt.target.value)


  selectPreviousTree : ->
    @selectNextTree(false)


  selectNextTree : ->
    @selectNextTree(true)


  createNewTree : ->
    @model.skeletonTracing.createNewTree()


  deleteTree : ->
    @model.skeletonTracing.deleteTree(true)


  shuffleTreeColor : ->
    @model.skeletonTracing.shuffleTreeColor()


  shuffleAllTreeColors : ->
    @model.skeletonTracing.shuffleAllTreeColors()


  sortTrees : (evt) ->
    evt.preventDefault()
    @model.user.set("sortTreesByName", ($(evt.currentTarget).data("sort") == "name"))

    @refresh()
    @updateSortIndicator()


  updateSortIndicator : ->

    isSortedByName = @model.user.get("sortTreesByName")
    @ui.sortNameIcon.toggle(isSortedByName)
    @ui.sortTimeIcon.toggle(!isSortedByName)


  selectNextTree : (next) ->

    @model.skeletonTracing.selectNextTree(next)
    @model.skeletonTracing.centerActiveNode()
    @updateName()


  getActiveTree : ->

    return @model.skeletonTracing.getTree()


  refresh : ->

    trees = @model.skeletonTracing.getTreesSorted()
    @collection.reset(trees)

    #@updateTreesDebounced()


  updateName : ->

      name = @getActiveTree().name
      @ui.treeNameInput.val(name)


  setActiveTree : (treeId) ->

    @model.skeletonTracing.setActiveTree(treeId)
    @model.skeletonTracing.centerActiveNode()


module.exports = ListTreeView
