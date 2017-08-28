/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.storage.kvstore

import com.scalableminds.util.mvc.BoxImplicits
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.Box
import play.api.libs.json._

import scala.concurrent.ExecutionContext.Implicits.global

case class KeyValuePair[T](key: String, value: T)

case class BackupInfo(id: String, timestamp: Long, size: Long)

object BackupInfo {
  implicit val backupInfoFormat = Json.format[BackupInfo]
}

trait KeyValueStore extends FoxImplicits {

  implicit protected def stringToByteArray(s: String): Array[Byte] = s.toCharArray.map(_.toByte)

  def get(key: String): Fox[Array[Byte]]

  def scan(key: String, prefix: Option[String] = None): Iterator[KeyValuePair[Array[Byte]]]

  def scanKeys(key: String, prefix: Option[String] = None): Iterator[String]

  def put(key: String, value: Array[Byte]): Fox[Unit]

  def getJson[T : Reads](key: String): Fox[T] = {
    get(key).flatMap(value => Json.parse(value).validate[T])
  }

  def scanJson[T : Reads](key: String, prefix: Option[String] = None): Iterator[KeyValuePair[T]] = {
    scan(key, prefix).flatMap { pair =>
      Json.parse(pair.value).validate[T].asOpt.map(KeyValuePair(pair.key, _))
    }
  }

  def putJson[T : Writes](key: String, value: T): Fox[Unit] = {
    put(key, Json.toJson(value).toString)
  }
}
