/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary

import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.ExtendedTypes.ExtendedByteArray
import scala.collection.mutable.ArraySeq
import scala.reflect.ClassTag

abstract class BinaryMessage

case class ParsedDataReadRequest(resolutionExponent: Int, position: Point3D, useHalfByte: Boolean)

case class ParsedDataWriteRequest(resolutionExponent: Int, position: Point3D, data: Array[Byte])

case class ParsedRequestCollection[T](requests: Array[T], handle: Option[Array[Byte]] = None) extends BinaryMessage

object BinaryProtocol {
  /**
   * Length of the different transfert parts of a message
   */
  val FloatByteSize = 4
  val HandleLength = FloatByteSize
  val ResolutionLength = FloatByteSize
  val UseHalfByteLength = FloatByteSize
  val CoordinatesLength = 3 * FloatByteSize
  val SingleReadPayloadSize = ResolutionLength + UseHalfByteLength + CoordinatesLength
  val SingleWritePayloadHeaderSize = ResolutionLength + CoordinatesLength

  private def hasValidLength(b: Array[Byte], containsHandle: Boolean, singlePayloadSize: Int) =
    if (containsHandle)
      b.length >= (singlePayloadSize + HandleLength)
    else
      b.length >= singlePayloadSize

  private def isFloatArray(b: Array[Byte]) = b.length % 4 == 0

  private def isValidReadPlayload(in: Array[Byte], containsHandle: Boolean) =
    hasValidLength(in, containsHandle, SingleReadPayloadSize) && isFloatArray(in)

  private def isValidWritePlayload(in: Array[Byte], containsHandle: Boolean, playloadBodySize: Int) =
    hasValidLength(in, containsHandle, SingleWritePayloadHeaderSize + playloadBodySize)

  private def parsePosition(b: Array[Byte]) = {
    val positionArray = b.subDivide(FloatByteSize).map(_.reverse.toIntFromFloat)
    Point3D.fromArray(positionArray)
  }

  /**
   * Parses a message sent as a data request. The message must have the following
   * structure:
   *
   * | resolution: Float | halfByte: Float | xPos: Float | yPos: Float | zPos: Float |
   *
   * Each float consists of 4 bytes.
   */

  private def parseDataReadRequestPayload(singleRequestPayload: Array[Byte]) = {
    val (binResolution, tail) = singleRequestPayload.splitAt(ResolutionLength)
    val (binUseHalfByte, binPosition) = tail.splitAt(UseHalfByteLength)

    parsePosition(binPosition).map {
      position =>
        val resolutionExponent = binResolution.reverse.toIntFromFloat
        val useHalfByte = binUseHalfByte.reverse.toBooleanFromFloat
        ParsedDataReadRequest(resolutionExponent, position, useHalfByte)
    }
  }

  /**
   * Parses a message sent as a data set request. The message must have the following
   * structure:
   *
   * | resolution: Float | xPos: Float | yPos: Float | zPos: Float | data Array[Byte]
   *
   * Each float consists of 4 bytes.
   */

  private def parseDataWriteRequestPayload(singleRequestPayload: Array[Byte]) = {
    val (binResolution, tail) = singleRequestPayload.splitAt(ResolutionLength)
    val (binPosition, data) = tail.splitAt(CoordinatesLength)

    parsePosition(binPosition).map {
      position =>
        val resolutionExponent = binResolution.reverse.toIntFromFloat
        ParsedDataWriteRequest(resolutionExponent, position, data)
    }
  }

  /**
   * Parses the handle of a message sent via websocket.
   */

  private def parseHandle(b: Array[Byte], containsHandle: Boolean) = {
    if (containsHandle) {
      val (data, handle) = b.splitAt(b.length - 1)
      (data, Some(handle))
    } else
      (b, None)
  }

  private def parsePayload[T](
                            multipleRequestPayload: Array[Byte],
                            singlePayloadSize: Int,
                            parseFunction: Array[Byte] => Option[T]
                          ): ArraySeq[T] = {
    multipleRequestPayload.subDivide(singlePayloadSize) flatMap {
      payload =>
        if (payload.length == singlePayloadSize)
          parseFunction(payload)
        else
          None
    }
  }

  def parse[T: ClassTag](in: Array[Byte], containsHandle: Boolean, singlePayloadSize: Int, parseFunction: Array[Byte] => Option[T]): ParsedRequestCollection[T] = {
    val (payload, handle) = parseHandle(in, containsHandle)
    val requests = parsePayload(in, singlePayloadSize, parseFunction)
    ParsedRequestCollection(requests.toArray, handle)
  }

  def parseDataReadRequests(in: Array[Byte], containsHandle: Boolean) = {
    if (isValidReadPlayload(in, containsHandle))
      Some(parse(in, containsHandle, SingleReadPayloadSize, parseDataReadRequestPayload))
    else
      None
  }

  def parseDataWriteRequests(in: Array[Byte], payloadBodySize: Int, containsHandle: Boolean) = {
    if (isValidWritePlayload(in, containsHandle, payloadBodySize)) {
      Some(parse(in, containsHandle, SingleWritePayloadHeaderSize + payloadBodySize, parseDataWriteRequestPayload))
    } else
      None
  }
}