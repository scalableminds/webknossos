package brainflight.binary

import brainflight.tools.geometry.Vector3I
import brainflight.tools.ExtendedTypes._
import brainflight.tools.geometry.Point3D

trait Handle {
  var handle: Array[Byte] = Array()

  def setHandle( h: Array[Byte] ) {
    handle = h
  }
}

abstract class BinaryMessage extends Handle

case class RequestData( resolutionExponent: Int, position: Point3D ) extends BinaryMessage

object BinaryProtocol {
  /**
   * Length of the different transfert parts of a message
   */
  val HandleLength = 4
  val ZoomLevelLength = 4
  val CoordinatesLength = 12
  /**
   * An ajax request must always contain a zoom level and the coordinates
   */
  val MinAjaxRequestSize = ZoomLevelLength + CoordinatesLength
  /**
   * A websocket request must contain a handle, the zoom level and the coordinates
   */
  val MinWebSocketRequestSize = HandleLength + ZoomLevelLength + CoordinatesLength

  def parsePayload( payload: Array[Byte] ) = {
    val ( binResolution, binPosition ) = payload.splitAt( 4 )

    // calculate the upper left corner of the data cube
    val positionArray = binPosition.subDivide( 4 ).map( _.reverse.toIntFromFloat )

    Point3D.fromArray( positionArray ).map { position =>
      val resolutionExponent = binResolution.reverse.toIntFromFloat
      RequestData( resolutionExponent, position )
    }
  }

  /**
   * Parses a message sent on a websocket. The message must have the following
   * structure:
   *
   * | handle: Float | zoomLevel: Float | xPos: Float | yPos: Float | zPos: Float |
   *
   * Each float consists of 4 bytes.
   */
  def parseWebsocket( in: Array[Byte] ): Option[BinaryMessage] = {
    if ( in.length >= MinWebSocketRequestSize && in.length % 4 == 0 ) {
      val ( binHandle, binPayload ) = in.splitAt( HandleLength )
      parsePayload( binPayload ).map { message =>
        message.setHandle( binHandle )
        message
      }
    } else {
      None
    }
  }

  /**
   * Parses a message sent via HTTP POST. The message must have the same
   * structure as a websocket message, but doesn't contain the handle field.
   */
  def parseAjax( in: Array[Byte] ): Option[BinaryMessage] = {
    if ( in.size >= MinAjaxRequestSize ) {
      parsePayload( in )
    } else {
      None
    }
  }
}