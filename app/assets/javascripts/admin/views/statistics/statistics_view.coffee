### define
underscore : _
backbone.marionette : marionette
###

class StatisticsView extends Backbone.Marionette.CompositeView

  className : "statistics container wide"
  template : _.template("""
    <h3>Statistics</h3>
  """)