### define
underscore : _
jquery : $
kinetic : Kinetic
###

class ErrorView

  DEFAULT_FONT : "Helvetica, Arial, sans-serif"

  constructor : (view, @layer, message = "") ->

    @sign = new Kinetic.RegularPolygon(
      x : view.width / 2
      y : view.height / 2 - 20
      radius : 50
      sides : 3
      stroke : "#444"
      strokeWidth : 4
    )
    @layer.add(@sign)

    @mark = new Kinetic.Text(
      fontSize : 50
      fontStyle : "bold"
      fontFamily : @DEFAULT_FONT
      text : "!"
      textFill : "#444"
    )
    @mark.setX (view.width - @mark.getTextWidth()) / 2
    @mark.setY (view.height - @mark.getTextHeight()) / 2 - 25
    @layer.add(@mark)

    @message = new Kinetic.Text(
      y : view.height - 100
      width : view.width - 40
      fontSize : 12
      fontFamily : @DEFAULT_FONT
      text : "Sorry, we couldn't load this sequence. Please try again.\n\n#{message}"
      textFill : "#444"
    )
    @message.setX (view.width - @message.getTextWidth()) / 2
    @layer.add(@message)



  destroy : ->

    @sign.remove()

