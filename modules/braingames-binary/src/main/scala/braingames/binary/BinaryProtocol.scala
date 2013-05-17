package braingames.binary

import braingames.geometry.Vector3I
import braingames.geometry.Point3D
import braingames.util.ExtendedTypes.ExtendedByteArray

trait Handle {
  var handle: Array[Byte] = Array()

  def setHandle(h: Array[Byte]) {
    handle = h
  }
}

abstract class BinaryMessage extends Handle

case class SingleDataRequest(resolutionExponent: Int, position: Point3D, useHalfByte: Boolean)
case class MultipleDataRequest(requests: Array[SingleDataRequest]) extends BinaryMessage

object MultipleDataRequest {
  def apply(r: SingleDataRequest): MultipleDataRequest = MultipleDataRequest(Array(r))
}

object BinaryProtocol {
  /**
   * Length of the different transfert parts of a message
   */
  val HandleLength = 4
  val ResolutionLength = 4
  val UseHalfByteLength = 4
  val CoordinatesLength = 12

  val RequestSize = ResolutionLength + UseHalfByteLength + CoordinatesLength
  /**
   * An ajax request must always contain a zoom level and the coordinates
   */
  val MinAjaxRequestSize = RequestSize
  /**
   * A websocket request must contain a handle, the zoom level and the coordinates
   */
  val MinWebSocketRequestSize = RequestSize + HandleLength

  def parseSingleRequestPayload(singleRequestPayload: Array[Byte]) = {
    if (singleRequestPayload.length == RequestSize) {
      val (binResolution, tail) = singleRequestPayload.splitAt(4)
      val (binUseHalfByte, binPosition) = tail.splitAt(4)

      // calculate the upper left corner of the data cube
      val positionArray = binPosition.subDivide(4).map(_.reverse.toIntFromFloat)

      Point3D.fromArray(positionArray).map { position =>
        val resolutionExponent = binResolution.reverse.toIntFromFloat
        val useHalfByte = binUseHalfByte.reverse.toBooleanFromFloat
        SingleDataRequest(resolutionExponent, position, useHalfByte)
      }
    } else {
      None
    }
  }

  def parsePayload(multipleRequestPayload: Array[Byte]): Option[BinaryMessage] = {
    val requests = multipleRequestPayload.subDivide(RequestSize) flatMap {
      parseSingleRequestPayload
    }

    if (requests.size > 0)
      Some(MultipleDataRequest(requests))
    else
      None
  }

  /**
   * Parses a message sent on a websocket. The message must have the following
   * structure:
   *
   * | resolution: Float | halfByte: Float | xPos: Float | yPos: Float | zPos: Float | handle: Float |
   *
   * Each float consists of 4 bytes.
   */
  def parseWebsocket(in: Array[Byte]): Option[BinaryMessage] = {
    if (in.length >= MinWebSocketRequestSize && in.length % 4 == 1) {
      val (binPayload, binHandle) = in.splitAt(in.length - 1)
      parsePayload(binPayload).map { message =>
        message.setHandle(binHandle)
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
  def parseAjax(in: Array[Byte]): Option[BinaryMessage] = {
    if (in.size >= MinAjaxRequestSize) {
      parsePayload(in)
    } else {
      None
    }
  }
}