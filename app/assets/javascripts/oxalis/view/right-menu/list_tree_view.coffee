### define
underscore : _
app : app
backbone.marionette : marionette
###

class ListTreeView extends Backbone.Marionette.ItemView

  template : _.template("""
    <div id="tree-navbar">
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
            <a href="#" data-sort="name">by name <i class="fa fa-check" id="sort-name-icon"></i></a>
          </li>
          <li>
            <a href="#" data-sort="id">by creation time <i class="fa fa-check" id= "sort-id-icon"></i></a>
          </li>
        </ul>
      </div>
      <div class="input-group">
        <span class="input-group-btn">
          <button class="btn btn-default" id="tree-prev-button"><i class="fa fa-arrow-left"></i></button>
        </span>
        <input name="name" id="tree-name-input" class="form-control" maxlength="30" type="text" autocomplete="off">
        <span class="input-group-btn">
          <button class="btn btn-default" id="tree-name-submit"><i class="fa fa-check"></i></button>
        </span>
        <span class="input-group-btn">
          <button class="btn btn-default" id="tree-next-button"><i class="fa fa-arrow-right"></i></button>
        </span>
      </div>
      <div>
        <ul id="tree-list"></ul>
      </div>
    </div>
    """)

  events :
    "change #tree-name-input" : "setTreeName"
    "click #tree-prev-button" : "selectPreviousTree"
    "click #tree-next-button" : "selectNextTree"
    "click #tree-create-button" : "createNewTree"
    "click #tree-delete-button" : "deleteTree"
    "click #tree-color-shuffle" : "shuffleTreeColor"
    "click #tree-color-shuffle-all" : "shuffleAllTreeColors"
    "click a[data-sort]" : "sortTrees"


  initialize : (options) ->

    {@_model} = options

    @listenTo(app.vent)


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

  # $("#tree-list").on "click", "a[data-treeid]", (event) =>
  #   event.preventDefault()
  #   @setActiveTree($(event.currentTarget).data("treeid"), true)

  shuffleTreeColor : ->
    @_model.skeletonTracing.shuffleTreeColor()

  shuffleAllTreeColors : ->
    @_model.skeletonTracing.shuffleAllTreeColors()

  sortTrees : (evt) ->
    evt.preventDefault()
    @_model.user.set("sortTreesByName", ($(evt.currentTarget).data("sort") == "name"))

  selectNextTree : (next) ->

    @model.skeletonTracing.selectNextTree(next)
    @model.skeletonTracing.centerActiveNode()
