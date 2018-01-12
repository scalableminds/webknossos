/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings

import com.google.protobuf.ByteString
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import com.scalableminds.fossildb.proto.fossildbapi._
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{Json, Reads, Writes}
import io.grpc.netty.NettyChannelBuilder
import play.api.{Configuration, Play}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.util.Try



trait KeyValueStoreImplicits extends BoxImplicits {

  implicit def stringToByteArray(s: String): Array[Byte] = s.toCharArray.map(_.toByte)

  implicit def toBox[T](x: T): Box[T] = Full(x)

  implicit def asJson[T](o: T)(implicit w: Writes[T]): Array[Byte] = w.writes(o).toString.getBytes("UTF-8")

  implicit def fromJson[T](a: Array[Byte])(implicit r: Reads[T]): Box[T] = jsResult2Box(Json.parse(a).validate)

  implicit def asProto[T <: GeneratedMessage](o: T): Array[Byte] = o.toByteArray

  implicit def fromProto[T <: GeneratedMessage with Message[T]](a: Array[Byte])(implicit companion: GeneratedMessageCompanion[T]): Box[T] = tryo(companion.parseFrom(a))
}

case class KeyValuePair[T](key: String, value: T)

case class VersionedKey(key: String, version: Long)

case class VersionedKeyValuePair[T](versionedKey: VersionedKey, value: T) {

  def key = versionedKey.key

  def version = versionedKey.version
}


class FossilDBClient(collection: String, config: Configuration) extends FoxImplicits with LazyLogging {
  val address = config.getString("datastore.fossildb.address").getOrElse("localhost")
  val port = config.getInt("datastore.fossildb.port").getOrElse(7155)
  val channel = NettyChannelBuilder.forAddress(address, port).maxInboundMessageSize(Int.MaxValue).usePlaintext(true).build
  val blockingStub = FossilDBGrpc.blockingStub(channel)

  def checkHealth = {
    try {
      val reply: HealthReply = blockingStub.health(HealthRequest())
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      logger.info("Successfully tested FossilDB health at " + address + ":" + port)
    } catch {
      case e: Exception => logger.error("Failed to connect to FossilDB at " + address + ":" + port + ": " + e)
    }
  }

  def get[T](key: String, version: Option[Long] = None, mayBeEmpty: Option[Boolean] = None)(implicit fromByteArray: Array[Byte] => Box[T]): Fox[VersionedKeyValuePair[T]] = {
    try {
      val reply: GetReply = blockingStub.get(GetRequest(collection, key, version, mayBeEmpty))
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      fromByteArray(reply.value.toByteArray).map(VersionedKeyValuePair(VersionedKey(key, reply.actualVersion), _))
    } catch {
      case e: Exception => Fox.failure("Could not get from FossilDB: " + e.getMessage)
    }
  }

  def getVersion(key: String, version: Option[Long] = None, mayBeEmpty: Option[Boolean] = None): Fox[Long] = {
    try {
      val reply = blockingStub.get(GetRequest(collection, key, version, mayBeEmpty))
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      Fox.successful(reply.actualVersion)
    } catch {
      case e: Exception => Fox.failure("Could not get from FossilDB: " + e.getMessage)
    }
  }

  def getMultipleKeys[T](key: String, prefix: Option[String] = None, version: Option[Long] = None)(implicit fromByteArray: Array[Byte] => Box[T]): List[KeyValuePair[T]] = {
    def flatCombineTuples[A,B](keys: List[A], values: List[Box[B]]) = {
      val boxTuples: List[Box[(A,B)]] = keys.zip(values).map {
        case (k, Full(v)) => Full(k,v)
        case _ => Empty
      }
      boxTuples.flatten
    }

    val reply = blockingStub.getMultipleKeys(GetMultipleKeysRequest(collection, key, prefix, version))
    if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
    val parsedValues: List[Box[T]] = reply.values.map{ v => fromByteArray(v.toByteArray)}.toList
    flatCombineTuples(reply.keys.toList, parsedValues).map{t => KeyValuePair(t._1, t._2)}
  }

  def getMultipleVersions[T](key: String, newestVersion: Option[Long] = None, oldestVersion: Option[Long] = None)
                            (implicit fromByteArray: Array[Byte] => Box[T]): Fox[List[T]] = {
    try {
      val reply = blockingStub.getMultipleVersions(GetMultipleVersionsRequest(collection, key, newestVersion, oldestVersion))
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      val parsedValues: List[Box[T]] = reply.values.map{v => fromByteArray(v.toByteArray)}.toList
      Fox.combined(parsedValues.map{box: Box[T] => box.toFox})
    } catch {
      case e: Exception => Fox.failure("could not get multiple versions from FossilDB" + e.getMessage)
    }
  }

  def put[T](key: String, version: Long, value: Array[Byte])(implicit toByteArray: T => Array[Byte]): Fox[_] = {
    try {
      val reply = blockingStub.put(PutRequest(collection, key, Some(version), ByteString.copyFrom(value)))
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      Fox.successful(Unit)
    } catch {
      case e: Exception => Fox.failure("could not save to FossilDB: " + e.getMessage)
    }
  }

}
