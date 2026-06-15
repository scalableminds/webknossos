package com.scalableminds.util.objectid

import com.scalableminds.util.Msg
import com.scalableminds.util.tools.TextUtils.parseCommaSeparated
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.json.*
import play.api.mvc.{PathBindable, QueryStringBindable}
import scala.concurrent.ExecutionContext

// Follows BSON ObjectId spec https://github.com/mongodb/specifications/blob/master/source/bson-objectid/objectid.md#design-rationale

case class ObjectId(id: String) {
  override def toString: String = id
}

object ObjectId extends FoxImplicits {
  private lazy val maxCounterValue = 16777216
  private lazy val atomicCounter = new java.util.concurrent.atomic.AtomicInteger(scala.util.Random.nextInt(maxCounterValue))
  private lazy val HEX_CHARS: Array[Char] = "0123456789abcdef".toCharArray

  private lazy val processRandomBytes: Array[Byte] = {
    val bytes = Array.ofDim[Byte](5)
    scala.util.Random.nextBytes(bytes)
    bytes
  }

  def generate: ObjectId = {
    val id = Array.ofDim[Byte](12)

    // 4 bytes (8 hex chars): seconds since Unix epoch. Big endian
    val timestamp = (System.currentTimeMillis() / 1000L).toInt
    id(0) = (timestamp >> 24).toByte
    id(1) = (timestamp >> 16).toByte
    id(2) = (timestamp >> 8).toByte
    id(3) = timestamp.toByte

    // 5 bytes (10 hex chars): random value, generated once per process
    id(4) = processRandomBytes(0)
    id(5) = processRandomBytes(1)
    id(6) = processRandomBytes(2)
    id(7) = processRandomBytes(3)
    id(8) = processRandomBytes(4)

    // 3 bytes (6 hex chars): incrementing counter with randomized start. Big endian
    val c = (atomicCounter.getAndIncrement + maxCounterValue) % maxCounterValue
    id(9) = (c >> 16 & 0xFF).toByte
    id(10) = (c >> 8 & 0xFF).toByte
    id(11) = (c & 0xFF).toByte

    ObjectId(hex2Str(id))
  }

  def fromString(literal: String)(implicit ec: ExecutionContext): Fox[ObjectId] =
    fromStringSync(literal).toFox ?~> Msg.ObjectId.invalid(literal)

  def fromCommaSeparated(idsStrOpt: Option[String])(implicit ec: ExecutionContext): Fox[List[ObjectId]] =
    parseCommaSeparated(idsStrOpt)(fromString)

  // valid object ids have 24 lowercase hex chars
  private lazy val objectIdPattern = "^[0-9a-f]{24}$".r

  def fromStringSync(literal: String): Option[ObjectId] =
    if (objectIdPattern.matches(literal)) Some(ObjectId(literal)) else None

  // Accept human-readable prefix: anything-before-hyphen-<ObjectId>
  private def fromStringWithPrefixSync(literal: String): Option[ObjectId] = {
    val objectIdCandidate = literal.lastIndexOf('-') match {
      case -1  => literal
      case idx => literal.substring(idx + 1)
    }
    fromStringSync(objectIdCandidate)
  }

  lazy val dummyId: ObjectId = ObjectId("000000000000000000000000")

  implicit object ObjectIdFormat extends Format[ObjectId] {
    override def reads(json: JsValue): JsResult[ObjectId] =
      json.validate[String].flatMap { idString =>
        val parsedOpt = fromStringSync(idString)
        parsedOpt match {
          case Some(parsed) => JsSuccess(parsed)
          case None         => JsError(Msg.ObjectId.invalid(idString))
        }
      }

    override def writes(o: ObjectId): JsValue = JsString(o.id)
  }

  implicit def pathBinder: PathBindable[ObjectId] =
    new PathBindable[ObjectId] {
      override def bind(key: String, value: String): Either[String, ObjectId] =
        fromStringWithPrefixSync(value).toRight(
          s"Cannot parse URI path parameter $key with value “$value” as ObjectId.")

      override def unbind(key: String, value: ObjectId): String = value.id
    }

  implicit def queryBinder: QueryStringBindable[ObjectId] =
    new QueryStringBindable[ObjectId] {
      override def bind(key: String, params: Map[String, Seq[String]]): Option[Either[String, ObjectId]] =
        params.get(key).flatMap(_.headOption).map { value =>
          fromStringSync(value).toRight(s"Cannot parse URI query parameter $key with value “$value” as ObjectId.")
        }

      override def unbind(key: String, value: ObjectId): String = value.id
    }

  private def hex2Str(bytes: Array[Byte]): String = {
    val len = bytes.length
    val hex = new Array[Char](2 * len)
    var inputIndex = 0
    while (inputIndex < len) {
      val b = bytes(inputIndex)
      val outputIndex = 2 * inputIndex
      hex(outputIndex) = HEX_CHARS((b & 0xF0) >>> 4)
      hex(outputIndex + 1) = HEX_CHARS(b & 0x0F)
      inputIndex = inputIndex + 1
    }
    new String(hex)
  }
}
