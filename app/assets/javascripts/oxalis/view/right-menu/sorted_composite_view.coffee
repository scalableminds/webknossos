### define
backbone.marionette : Marionette
###


# THIS IS A HELPER VIEW TO DISPLAY AN ORDERED COLLECTION
# https://github.com/marionettejs/backbone.marionette/wiki/Adding-support-for-sorted-collections
#
# TODO remove and refactor tis view with Marionette v2.0 release, which will support this out of the box

class SortedCompositeView extends Backbone.Marionette.CompositeView

  appendHtml: (collectionView, itemView, index) ->

      childrenContainer = if collectionView.childViewContainer then collectionView.$(collectionView.childViewContainer) else collectionView.$el
      children = childrenContainer.children()

      if children.size() <= index
        childrenContainer.append(itemView.el)
      else
        children.eq(index).before(itemView.el)
