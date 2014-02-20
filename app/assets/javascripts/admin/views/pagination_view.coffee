### define
underscore : _
backbone.marionette : marionette
###

class PaginationView extends Backbone.Marionette.ItemView

  template : _.template("""
    <div class="pagination">
      <ul>
        <li class="prev disabled">
          <a href="#">«</a>
        </li>
        <li class="disabled">
          <a href="#">1</a>
        </li>
        <li class="next disabled">
          <a href="#">»</a>
        </li>
      </ul>
      <input type="text" class="search-query pagination-searchbox" placeholder="Search">
    </div>
  """)

  className : "container wide"
  initialize : ->

    #@listenTo(@, "")
