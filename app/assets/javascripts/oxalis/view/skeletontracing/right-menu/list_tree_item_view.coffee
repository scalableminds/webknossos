### define
backbone.marionette : Marionette
libs/utils : Utils
three.color : ColorConverter
###

class ListTreeItemView extends Backbone.Marionette.ItemView

  tagName : "li"
  template : _.template("""
    <i class="fa <%= getIcon() %>"></i>
    <a href="#" data-treeid="1">
      <span title="Node count" class="inline-block" style="width: 50px;"><%= nodes.length %></span>
      <i class="fa fa-circle" style="color: #<%= intToHex(color) %>"></i>
      <span title="Tree Name"><%= name %></span>
    </a>
  """)

  events :
    "click a" : "setActive"

  templateHelpers : ->
    getIcon : =>
      if @model.get("treeId") == @activeTreeId
        return "fa-angle-right"
      else
        return "fa-bull"

    intToHex : (int) ->

      return ('000000' + int.toString( 16 )).slice(-6) #see Three.Color.getHexString()


  initialize : (options) ->

    @activeTreeId = options.activeTreeId
    @parent = options.parent


  setActive : ->

    id = @model.get("treeId")
    @parent.setActiveTree(id)


  onShow : ->

    # scroll to active tree
    if @model.get("treeId") == @activeTreeId and not Utils.isElementInViewport(@el)
      @el.scrollIntoView()
