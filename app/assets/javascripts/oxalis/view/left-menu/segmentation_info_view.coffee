### define
backbone.marionette : marionette
app : app
oxalis/constants : constants
###

class SegmentationInfoView extends Backbone.Marionette.ItemView

  className : "col-sm-12"
  template : _.template("""
    <div class="well">
      <p>Segment ID: <%= segmentID %></p>
      <p>Segmentation Alpha: </p>
      <input type="range" id="alpha-slider" value="<%= sliderValue %>" min="0" max="100" step="1">
    </div>
  """)

  events :
    "change input" : "setSegmentationAlpha"

  initialize : (options) ->

    {@_model} = options
    @sliderValue = constants.DEFAULT_SEG_ALPHA

    if segmentationBinary = @_model.getSegmentationBinary()
      @listenTo(segmentationBinary.cube, "bucketLoaded", @render)


  setSegmentationAlpha : (event) ->

    @sliderValue = event.target.value
    if (@sliderValue == 0)
      @_model.getSegmentationBinary().pingStop()

    app.vent.trigger("segementationInfoView:change", @sliderValue)


  getSegmentID : ->

    if segmentationBinary = @_model.getSegmentationBinary()
      position = @_model.flycam.getPosition()
      segmentID = segmentationBinary.cube.getDataValue(position)

    return segmentID || "-"


  serializeData : ->

    return {
      sliderValue : @sliderValue
      segmentID : @getSegmentID()
    }
