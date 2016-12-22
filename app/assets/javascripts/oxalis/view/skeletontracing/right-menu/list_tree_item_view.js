Marionette             = require("backbone.marionette")
Utils                  = require("libs/utils")
ColorConverter         = require("three.color")
scrollIntoViewIfNeeded = require("scroll-into-view-if-needed")

class ListTreeItemView extends Marionette.View

  tagName : "li"
  template : _.template("""
    <i class="fa <%- getIcon() %>"></i>
    <a href="#" data-treeid="<%- treeId %>">
      <span title="Node count" class="inline-block tree-node-count" style="width: 50px;"><%- nodes.length %></span>
      <i class="fa fa-circle tree-icon" style="color: #<%- intToHex(color) %>"></i>
      <span title="Tree Name" class="tree-name"><%- name %></span>
    </a>
  """)

  events :
    "click a" : "setActive"

  templateContext : ->
    getIcon : =>
      if @model.get("treeId") == @activeTreeId
        return "fa-angle-right"
      else
        return "fa-bull"

    intToHex : Utils.intToHex


  initialize : (options) ->

    @activeTreeId = options.activeTreeId
    @parent = options.parent


  setActive : ->

    id = @model.get("treeId")
    @parent.setActiveTree(id)


  onRender : ->

    # scroll to active tree
    if @model.get("treeId") == @activeTreeId
      scrollIntoViewIfNeeded(@el)

module.exports = ListTreeItemView
