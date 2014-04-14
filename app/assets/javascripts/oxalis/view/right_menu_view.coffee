### define
backbone.marionette : marionette
./right-menu/comment_tab_view : CommentTabView
./right-menu/abstract_tree_view : AbstractTreeView
###

class RightMenuView extends Backbone.Marionette.Layout

  template : _.template("""
    <ul class="nav nav-tabs">
      <li class="active">
        <a href="#tab-abstract-tree" data-toggle="tab">Tree Viewer</a>
      </li>
      <li>
        <a href="#tab-trees" data-toggle="tab">Trees</a>
      </li>
      <li>
        <a href="#tab-comments" data-toggle="tab">Comments</a>
      </li>
    </ul>
    <div class="tab-content">
      <div class="tab-pane active" id="tab-abstract-tree"></div>
      <div class="tab-pane" id="tab-trees">
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
      </div>
      <div class="tab-pane" id="tab-comments"></div>
    </div>
  """)

  regions :
    "commentTab" : "#tab-comments"
    "abstractTreeTab" : "#tab-abstract-tree"

  initialize : (options) ->

    @commentTabView = new CommentTabView(options)
    @abstractTreeView = new AbstractTreeView(options)

    @listenTo(@, "show", @afterRender)


  afterRender : ->

      @commentTab.show(@commentTabView)
      @abstractTreeTab.show(@abstractTreeView)
