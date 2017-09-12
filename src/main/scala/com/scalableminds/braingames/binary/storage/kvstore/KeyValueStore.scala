/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.storage.kvstore

import com.scalableminds.util.mvc.BoxImplicits
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import net.liftweb.common.{Box, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json._

import scala.concurrent.ExecutionContext.Implicits.global

case class KeyValuePair[T](key: String, value: T)

case class BackupInfo(id: String, timestamp: Long, size: Long)

object BackupInfo {
  implicit val backupInfoFormat = Json.format[BackupInfo]
}

trait KeyValueStoreImplicits extends BoxImplicits {

  implicit def stringToByteArray(s: String): Array[Byte] = s.toCharArray.map(_.toByte)

  implicit def toBox[T](x: T): Box[T] = Full(x)

  implicit def asJson[T](o: T)(implicit w: Writes[T]): Array[Byte] = w.writes(o).toString.toCharArray.map(_.toByte)

  implicit def fromJson[T](a: Array[Byte])(implicit r: Reads[T]): Box[T] = jsResult2Box(Json.parse(a).validate)

  implicit def asProto[T <: GeneratedMessage](o: T): Array[Byte] = o.toByteArray

  implicit def fromProto[T <: GeneratedMessage with Message[T]](a: Array[Byte])(implicit companion: GeneratedMessageCompanion[T]): Box[T] = tryo(companion.parseFrom(a))
}

trait KeyValueStore extends KeyValueStoreImplicits with FoxImplicits {

  protected def getImpl(key: String): Fox[Array[Byte]]

  protected def scanImpl(key: String, prefix: Option[String] = None): Iterator[KeyValuePair[Array[Byte]]]

  protected def scanKeysImpl(key: String, prefix: Option[String] = None): Iterator[String]

  protected def putImpl(key: String, value: Array[Byte]): Fox[_]

  def get[T](key: String)(implicit fromByteArray: Array[Byte] => Box[T]): Fox[T] = {
    getImpl(key).flatMap(fromByteArray(_))
  }

  def scan[T](key: String, prefix: Option[String] = None)(implicit fromByteArray: Array[Byte] => Box[T]): Iterator[KeyValuePair[T]] = {
    scanImpl(key, prefix).flatMap { pair =>
      fromByteArray(pair.value).map(KeyValuePair(pair.key, _))
    }
  }

  def scanKeys(key: String, prefix: Option[String] = None): Iterator[String] = {
    scanKeysImpl(key, prefix)
  }

  def put[T](key: String, value: T)(implicit toByteArray: T => Array[Byte]): Fox[_] = {
    putImpl(key, value)
  }
}
