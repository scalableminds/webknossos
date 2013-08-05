package braingames.binary

import braingames.geometry.Point3D
import braingames.util.ExtendedTypes.ExtendedByteArray

abstract class BinaryMessage

case class ParsedRequest(resolutionExponent: Int, position: Point3D, useHalfByte: Boolean)

case class ParsedRequestCollection(requests: Array[ParsedRequest], handle: Option[Array[Byte]] = None) extends BinaryMessage

object BinaryProtocol {
  /**
   * Length of the different transfert parts of a message
   */
  val FloatByteSize = 4
  val HandleLength = FloatByteSize
  val ResolutionLength = FloatByteSize
  val UseHalfByteLength = FloatByteSize
  val CoordinatesLength = 3 * FloatByteSize

  val SinglePayloadSize = ResolutionLength + UseHalfByteLength + CoordinatesLength

  private def parsePosition(b: Array[Byte]) = {
    val positionArray = b.subDivide(FloatByteSize).map(_.reverse.toIntFromFloat)
    Point3D.fromArray(positionArray)
  }

  private def parseSingleRequestPayload(singleRequestPayload: Array[Byte]) = {
    if (singleRequestPayload.length == SinglePayloadSize) {
      val (binResolution, tail) = singleRequestPayload.splitAt(FloatByteSize)
      val (binUseHalfByte, binPosition) = tail.splitAt(FloatByteSize)

      parsePosition(binPosition).map {
        position =>
          val resolutionExponent = binResolution.reverse.toIntFromFloat
          val useHalfByte = binUseHalfByte.reverse.toBooleanFromFloat
          ParsedRequest(resolutionExponent, position, useHalfByte)
      }
    } else {
      None
    }
  }

  private def parsePayload(multipleRequestPayload: Array[Byte]): Array[ParsedRequest] = {
    multipleRequestPayload.subDivide(SinglePayloadSize) flatMap {
      parseSingleRequestPayload
    }
  }

  def isFloatArray(b: Array[Byte]) = b.length % 4 == 0

  private def hasValidLength(b: Array[Byte], containsHandle: Boolean) =
    if (containsHandle)
      b.length >= (SinglePayloadSize + HandleLength)
    else
      b.length >= SinglePayloadSize

  private def splitBeforeHandle(b: Array[Byte]) = {
    b.splitAt(b.length - 1)
  }

  /**
   * Parses a message sent on a websocket. The message must have the following
   * structure:
   *
   * | resolution: Float | halfByte: Float | xPos: Float | yPos: Float | zPos: Float | handle: Float |
   *
   * Each float consists of 4 bytes.
   */
  private def parseWithHandle(in: Array[Byte]) = {
    val (payload, handle) = splitBeforeHandle(in)
    val requests = parsePayload(payload)

    ParsedRequestCollection(requests, Some(handle))
  }

  /**
   * Parses a message sent via HTTP POST. The message must have the same
   * structure as a websocket message, but doesn't contain the handle field.
   */
  private def parseWithoutHandle(in: Array[Byte]) = {
    val requests = parsePayload(in)
    ParsedRequestCollection(requests)
  }

  def parse(in: Array[Byte], containsHandle: Boolean) = {
    if (hasValidLength(in, containsHandle) && isFloatArray(in)) {
      val parseResult =
        if (containsHandle)
          parseWithHandle(in)
        else
          parseWithoutHandle(in)
      Some(parseResult)
    } else {
      None
    }
  }
}