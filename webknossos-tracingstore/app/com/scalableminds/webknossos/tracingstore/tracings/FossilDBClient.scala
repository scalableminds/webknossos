package com.scalableminds.webknossos.tracingstore.tracings

import com.google.protobuf.ByteString
import com.scalableminds.fossildb.proto.fossildbapi._
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.TracingStoreConfig
import com.scalableminds.webknossos.tracingstore.slacknotification.TSSlackNotificationService
import com.typesafe.scalalogging.LazyLogging
import io.grpc.health.v1._
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder
import io.grpc.{Status, StatusRuntimeException}
import net.liftweb.common.{Box, Empty, Full}
import net.liftweb.common.Box.tryo
import play.api.libs.json.{Json, Reads, Writes}
import scalapb.grpc.Grpc
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

trait KeyValueStoreImplicits extends BoxImplicits {

  implicit def stringToByteArray(s: String): Array[Byte] = s.toCharArray.map(_.toByte)

  implicit def toBox[T](x: T): Box[T] = Full(x)

  implicit def toJsonBytes[T](o: T)(implicit w: Writes[T]): Array[Byte] = w.writes(o).toString.getBytes("UTF-8")

  implicit def fromJsonBytes[T](a: Array[Byte])(implicit r: Reads[T]): Box[T] = jsResult2Box(Json.parse(a).validate)

  implicit def toProtoBytes[T <: GeneratedMessage](o: T): Array[Byte] = o.toByteArray

  implicit def fromProtoBytes[T <: GeneratedMessage](a: Array[Byte])(
      implicit companion: GeneratedMessageCompanion[T]): Box[T] = tryo(companion.parseFrom(a))
}

case class VersionedKey(key: String, version: Long)

case class VersionedKeyValuePair[T](versionedKey: VersionedKey, value: T) {
  def key: String = versionedKey.key
  def version: Long = versionedKey.version
}

class FossilDBClient(collection: String,
                     config: TracingStoreConfig,
                     slackNotificationService: TSSlackNotificationService)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {
  private val address = config.Tracingstore.Fossildb.address
  private val port = config.Tracingstore.Fossildb.port
  private val channel =
    NettyChannelBuilder.forAddress(address, port).maxInboundMessageSize(Int.MaxValue).usePlaintext.build
  private val stub = FossilDBGrpc.stub(channel)
  private val blockingStub = FossilDBGrpc.blockingStub(channel)
  private val healthStub = HealthGrpc.newFutureStub(channel)
  lazy val authority: String = f"$address:$port"

  def checkHealth(verbose: Boolean = false): Fox[Unit] = {
    val resultFox = for {
      reply: HealthCheckResponse <- wrapException(
        Grpc.guavaFuture2ScalaFuture(healthStub.check(HealthCheckRequest.getDefaultInstance)))
      replyString = reply.getStatus.toString
      _ <- bool2Fox(replyString == "SERVING") ?~> replyString
      _ = if (verbose)
        logger.info(f"Successfully tested FossilDB health at $authority. Reply: " + replyString)
    } yield ()
    for {
      box <- resultFox.futureBox
      _ <- box match {
        case Full(()) => Fox.successful(())
        case Empty    => Fox.empty
        case net.liftweb.common.Failure(msg, _, _) =>
          val errorText = s"Failed to connect to FossilDB at $authority: $msg"
          logger.error(errorText)
          Fox.failure(errorText)
      }
    } yield ()
  }

  private def wrapException[T](future: Future[T]): Fox[T] =
    future.transformWith {
      case Success(value) =>
        Fox.successful(value).futureBox
      case Failure(exception) =>
        val box = exception match {
          case e: StatusRuntimeException if e.getStatus == Status.UNAVAILABLE =>
            new net.liftweb.common.Failure(s"FossilDB is unavailable", Full(e), Empty) ~> 500
          case e: Exception =>
            val messageWithCauses = new StringBuilder
            messageWithCauses.append(e.toString)
            var cause: Throwable = e.getCause
            while (cause != null) {
              messageWithCauses.append(" <- ")
              messageWithCauses.append(cause.toString)
              cause = cause.getCause
            }
            new net.liftweb.common.Failure(s"Request to FossilDB failed: $messageWithCauses", Full(e), Empty)
        }
        Future.successful(box)
    }

  private def assertSuccess(success: Boolean,
                            errorMessage: Option[String],
                            mayBeEmpty: Option[Boolean] = None): Fox[Unit] =
    if (mayBeEmpty.getOrElse(false) && errorMessage.contains("No such element")) Fox.empty
    else bool2Fox(success) ?~> errorMessage.getOrElse("")

  def get[T](key: String, version: Option[Long] = None, mayBeEmpty: Option[Boolean] = None)(
      implicit fromByteArray: Array[Byte] => Box[T]): Fox[VersionedKeyValuePair[T]] =
    for {
      reply <- wrapException(stub.get(GetRequest(collection, key, version, mayBeEmpty)))
      _ <- assertSuccess(reply.success, reply.errorMessage, mayBeEmpty)
      result <- fromByteArray(reply.value.toByteArray)
        .map(VersionedKeyValuePair(VersionedKey(key, reply.actualVersion), _))
    } yield result

  def getVersion(key: String,
                 version: Option[Long] = None,
                 mayBeEmpty: Option[Boolean] = None,
                 emptyFallback: Option[Long] = None): Fox[Long] =
    for {
      reply <- wrapException(stub.get(GetRequest(collection, key, version, mayBeEmpty)))
      result <- if (reply.success)
        Fox.successful(reply.actualVersion)
      else if (mayBeEmpty.contains(true) && emptyFallback.isDefined && reply.errorMessage.contains("No such element")) {
        emptyFallback.toFox
      } else Fox.failure(s"Could not get from FossilDB: ${reply.errorMessage.getOrElse("")}")
    } yield result

  def getMultipleKeys[T](
      startAfterKey: Option[String],
      prefix: Option[String],
      version: Option[Long] = None,
      limit: Option[Int] = None)(implicit fromByteArray: Array[Byte] => Box[T]): List[VersionedKeyValuePair[T]] = {
    def flatCombineTuples[A, B, C](keys: List[A], versions: List[B], values: List[Box[C]]) = {
      val boxTuples: List[Box[(A, B, C)]] = keys.zip(versions).zip(values).map {
        case ((k, v), Full(value)) => Full(k, v, value)
        case _                     => Empty
      }
      boxTuples.flatten
    }

    val reply = blockingStub.getMultipleKeys(GetMultipleKeysRequest(collection, startAfterKey, prefix, version, limit))
    if (!reply.success) throw new Exception(reply.errorMessage.getOrElse(""))
    val parsedValues: List[Box[T]] = reply.values.map { v =>
      fromByteArray(v.toByteArray)
    }.toList
    flatCombineTuples(reply.keys.toList, reply.actualVersions.toList, parsedValues).map { t =>
      VersionedKeyValuePair(VersionedKey(t._1, t._2), t._3)
    }
  }

  def getMultipleKeysByList[T](keys: Seq[String], version: Option[Long], batchSize: Int = 1000)(
      implicit fromByteArray: Array[Byte] => Box[T]): Fox[Seq[Box[VersionedKeyValuePair[T]]]] =
    for {
      batchedResults <- Fox.serialCombined(keys.grouped(batchSize))(keyBatch =>
        getMultipleKeysByListImpl(keyBatch, version))
    } yield batchedResults.flatten

  private def getMultipleKeysByListImpl[T](keys: Seq[String], version: Option[Long])(
      implicit fromByteArray: Array[Byte] => Box[T]): Fox[Seq[Box[VersionedKeyValuePair[T]]]] =
    for {
      reply: GetMultipleKeysByListReply <- stub.getMultipleKeysByList(
        GetMultipleKeysByListRequest(collection, keys, version))
      _ <- assertSuccess(reply.success, reply.errorMessage)
      parsedValues: Seq[Box[VersionedKeyValuePair[T]]] = keys.zip(reply.versionValueBoxes).map {
        case (key, versionValueBox) =>
          versionValueBox match {
            case VersionValueBoxProto(Some(versionValuePair), None, _) =>
              for {
                parsed <- fromByteArray(versionValuePair.value.toByteArray)
              } yield VersionedKeyValuePair(VersionedKey(key, versionValuePair.actualVersion), parsed)
            case VersionValueBoxProto(None, Some(errorMessage), _) =>
              net.liftweb.common.Failure(s"Failed to get entry from FossilDB: $errorMessage")
            case VersionValueBoxProto(None, None, _) => Empty
            case _                                   => net.liftweb.common.Failure("unexpected reply format in fossilDB getMultipleKeysByList")
          }
        case _ => net.liftweb.common.Failure("unexpected reply format in fossilDB getMultipleKeysByList")
      }
    } yield parsedValues

  def getMultipleVersionsAsVersionValueTuple[T](
      key: String,
      newestVersion: Option[Long] = None,
      oldestVersion: Option[Long] = None)(implicit fromByteArray: Array[Byte] => Box[T]): Fox[List[(Long, T)]] =
    (for {
      reply <- wrapException(
        stub.getMultipleVersions(GetMultipleVersionsRequest(collection, key, newestVersion, oldestVersion)))
      _ <- assertSuccess(reply.success, reply.errorMessage)
      parsedValues: List[Box[T]] = reply.values.map { v =>
        fromByteArray(v.toByteArray)
      }.toList
      values <- Fox.combined(parsedValues.map { box: Box[T] =>
        box.toFox
      })
    } yield reply.versions.zip(values).toList) ?~> "Could not get multiple versions from FossilDB"

  def put(key: String, version: Long, value: Array[Byte]): Fox[Unit] = {
    val putFox = for {
      reply <- wrapException(stub.put(PutRequest(collection, key, Some(version), ByteString.copyFrom(value))))
      _ <- assertSuccess(reply.success, reply.errorMessage)
    } yield ()
    for {
      box <- putFox.futureBox
      _ <- box match {
        case Full(()) => Fox.successful(())
        case Empty    => Fox.empty
        case net.liftweb.common.Failure(msg, _, _) =>
          slackNotificationService.reportFossilWriteError("put", msg)
          Fox.failure("could not save to FossilDB: " + msg)
      }
    } yield ()
  }

  def putMultiple(keyValueTuple: Seq[(String, Array[Byte])], version: Long, batchSize: Int = 1000): Fox[Unit] =
    for {
      _ <- Fox.serialCombined(keyValueTuple.grouped(batchSize))(batch => putMultipleImpl(batch, version))
    } yield ()

  private def putMultipleImpl(keyValueTuples: Seq[(String, Array[Byte])], version: Long): Fox[Unit] = {
    val putFox = for {
      _ <- Fox.successful(logger.info(s"fossil multi-put for ${keyValueTuples.length} keys to $collection"))
      keyValuePairs = keyValueTuples.map {
        case (key, value) => VersionedKeyValuePairProto(key, version, ByteString.copyFrom(value))
      }
      reply <- wrapException(
        stub.putMultipleKeysWithMultipleVersions(PutMultipleKeysWithMultipleVersionsRequest(collection, keyValuePairs)))
      _ <- assertSuccess(reply.success, reply.errorMessage)
    } yield ()
    for {
      box <- putFox.futureBox
      _ <- box match {
        case Full(()) => Fox.successful(())
        case Empty    => Fox.empty
        case net.liftweb.common.Failure(msg, _, _) =>
          slackNotificationService.reportFossilWriteError("put", msg)
          Fox.failure("could not multi-put to FossilDB: " + msg)
      }
    } yield ()
  }

  def shutdown(): Boolean = {
    channel.shutdownNow()
    channel.awaitTermination(10, java.util.concurrent.TimeUnit.SECONDS)
  }

}
