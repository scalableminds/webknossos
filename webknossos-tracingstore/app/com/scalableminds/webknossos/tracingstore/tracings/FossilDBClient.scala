package com.scalableminds.webknossos.tracingstore.tracings

import com.google.protobuf.ByteString
import com.scalableminds.fossildb.proto.fossildbapi._
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.scalableminds.webknossos.tracingstore.slacknotification.SlackNotificationService
import com.typesafe.scalalogging.LazyLogging
import io.grpc.health.v1._
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder
import io.grpc.{Status, StatusRuntimeException}
import net.liftweb.common.{Box, Empty, Full}
import net.liftweb.util.Helpers.tryo
import play.api.libs.json.{Json, Reads, Writes}
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import scala.concurrent.ExecutionContext.Implicits.global

trait KeyValueStoreImplicits extends BoxImplicits {

  implicit def stringToByteArray(s: String): Array[Byte] = s.toCharArray.map(_.toByte)

  implicit def toBox[T](x: T): Box[T] = Full(x)

  implicit def asJson[T](o: T)(implicit w: Writes[T]): Array[Byte] = w.writes(o).toString.getBytes("UTF-8")

  implicit def fromJson[T](a: Array[Byte])(implicit r: Reads[T]): Box[T] = jsResult2Box(Json.parse(a).validate)

  implicit def asProto[T <: GeneratedMessage](o: T): Array[Byte] = o.toByteArray

  implicit def fromProto[T <: GeneratedMessage](a: Array[Byte])(
      implicit companion: GeneratedMessageCompanion[T]): Box[T] = tryo(companion.parseFrom(a))
}

case class KeyValuePair[T](key: String, value: T)

case class VersionedKey(key: String, version: Long)

case class VersionedKeyValuePair[T](versionedKey: VersionedKey, value: T) {
  def key: String = versionedKey.key
  def version: Long = versionedKey.version
}

class FossilDBClient(collection: String, config: TracingStoreConfig, slackNotificationService: SlackNotificationService)
    extends FoxImplicits
    with LazyLogging {
  private val address = config.Tracingstore.Fossildb.address
  private val port = config.Tracingstore.Fossildb.port
  private val channel =
    NettyChannelBuilder.forAddress(address, port).maxInboundMessageSize(Int.MaxValue).usePlaintext.build
  private val blockingStub = FossilDBGrpc.blockingStub(channel)
  private val blockingStubHealth = HealthGrpc.newBlockingStub(channel)

  def checkHealth: Fox[Unit] =
    try {
      val reply: HealthCheckResponse = blockingStubHealth.check(HealthCheckRequest.getDefaultInstance)
      val replyString = reply.getStatus.toString
      if (!(replyString == "SERVING")) throw new Exception(replyString)
      logger.info("Successfully tested FossilDB health at " + address + ":" + port + ". Reply: " + replyString)
      Fox.successful(())
    } catch {
      case e: Exception =>
        val errorText = "Failed to connect to FossilDB at " + address + ":" + port + ": " + e
        logger.error(errorText)
        Fox.failure(errorText)
    }

  def get[T](key: String, version: Option[Long] = None, mayBeEmpty: Option[Boolean] = None)(
      implicit fromByteArray: Array[Byte] => Box[T]): Fox[VersionedKeyValuePair[T]] =
    try {
      val reply: GetReply = blockingStub.get(GetRequest(collection, key, version, mayBeEmpty))
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      fromByteArray(reply.value.toByteArray).map(VersionedKeyValuePair(VersionedKey(key, reply.actualVersion), _))
    } catch {
      case statusRuntimeException: StatusRuntimeException =>
        if (statusRuntimeException.getStatus == Status.UNAVAILABLE) Fox.failure("FossilDB is unavailable") ~> 500
        else Fox.failure("Could not get from FossilDB: " + statusRuntimeException.getMessage)
      case e: Exception => Fox.failure("Could not get from FossilDB: " + e.getMessage)
    }

  def getVersion(key: String,
                 version: Option[Long] = None,
                 mayBeEmpty: Option[Boolean],
                 emptyFallback: Option[Long] = None): Fox[Long] =
    try {
      val reply = blockingStub.get(GetRequest(collection, key, version, mayBeEmpty))
      if (reply.success) Fox.successful(reply.actualVersion)
      else {
        if (mayBeEmpty.contains(true) && emptyFallback.isDefined && reply.errorMessage.contains("No such element")) {
          emptyFallback.toFox
        } else {
          throw new Exception(reply.errorMessage.getOrElse(""))
        }
      }
    } catch {
      case e: Exception => Fox.failure("Could not get from FossilDB: " + e.getMessage)
    }

  def getMultipleKeys[T](
      key: String,
      prefix: Option[String] = None,
      version: Option[Long] = None,
      limit: Option[Int] = None)(implicit fromByteArray: Array[Byte] => Box[T]): List[VersionedKeyValuePair[T]] = {
    def flatCombineTuples[A, B, C](keys: List[A], versions: List[B], values: List[Box[C]]) = {
      val boxTuples: List[Box[(A, B, C)]] = (keys, versions, values).zipped.map {
        case (k, v, Full(value)) => Full(k, v, value)
        case _                   => Empty
      }
      boxTuples.flatten
    }

    val reply = blockingStub.getMultipleKeys(GetMultipleKeysRequest(collection, key, prefix, version, limit))
    if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
    val parsedValues: List[Box[T]] = reply.values.map { v =>
      fromByteArray(v.toByteArray)
    }.toList
    flatCombineTuples(reply.keys.toList, reply.actualVersions.toList, parsedValues).map { t =>
      VersionedKeyValuePair(VersionedKey(t._1, t._2), t._3)
    }
  }

  def getMultipleVersions[T](key: String, newestVersion: Option[Long] = None, oldestVersion: Option[Long] = None)(
      implicit fromByteArray: Array[Byte] => Box[T]): Fox[List[T]] =
    for {
      versionValueTuples <- getMultipleVersionsAsVersionValueTuple(key, newestVersion, oldestVersion)
    } yield versionValueTuples.map(_._2)

  def getMultipleVersionsAsVersionValueTuple[T](
      key: String,
      newestVersion: Option[Long] = None,
      oldestVersion: Option[Long] = None)(implicit fromByteArray: Array[Byte] => Box[T]): Fox[List[(Long, T)]] =
    try {
      val reply =
        blockingStub.getMultipleVersions(GetMultipleVersionsRequest(collection, key, newestVersion, oldestVersion))
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      val parsedValues: List[Box[T]] = reply.values.map { v =>
        fromByteArray(v.toByteArray)
      }.toList
      for {
        values <- Fox.combined(parsedValues.map { box: Box[T] =>
          box.toFox
        })
      } yield reply.versions.zip(values).toList
    } catch {
      case e: Exception => Fox.failure("could not get multiple versions from FossilDB: " + e.getMessage)
    }

  def put[T](key: String, version: Long, value: Array[Byte]): Fox[Unit] =
    try {
      val reply = blockingStub.put(PutRequest(collection, key, Some(version), ByteString.copyFrom(value)))
      if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
      Fox.successful(Unit)
    } catch {
      case e: Exception =>
        slackNotificationService.reportFossilWriteError("put", e)
        Fox.failure("could not save to FossilDB: " + e.getMessage)
    }

  def shutdown(): Boolean = {
    channel.shutdownNow()
    channel.awaitTermination(10, java.util.concurrent.TimeUnit.SECONDS)
  }

}
