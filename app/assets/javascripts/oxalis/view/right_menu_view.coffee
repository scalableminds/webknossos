### define
backbone.marionette : marionette
./right-menu/comment_tab_view : CommentTabView
./right-menu/abstract_tree_view : AbstractTreeView
./right-menu/list_tree_view : ListTreeView
###

class RightMenuView extends Backbone.Marionette.Layout

  MARGIN : 40
  className : "flex-column-container"
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
      <div class="tab-pane" id="tab-trees"></div>
      <div class="tab-pane" id="tab-comments"></div>
    </div>
  """)

  ui :
    "tabContentContainer" : ".tab-content"

  regions :
    "commentTab" : "#tab-comments"
    "abstractTreeTab" : "#tab-abstract-tree"
    "listTreeTab" : "#tab-trees"

  initialize : (options) ->

    @commentTabView = new CommentTabView(options)
    @abstractTreeView = new AbstractTreeView(options)
    @listTreeView = new ListTreeView(options)

    @listenTo(@, "render", @afterRender)


  resize : ->

    _.defer =>
      # make tab content 100% height
      tabContentPosition = @ui.tabContentContainer.position()
      @ui.tabContentContainer.height(window.innerHeight - tabContentPosition.top - @MARGIN)


  afterRender : ->

      @commentTab.show(@commentTabView)
      @abstractTreeTab.show(@abstractTreeView)
      @listTreeTab.show(@listTreeView)
