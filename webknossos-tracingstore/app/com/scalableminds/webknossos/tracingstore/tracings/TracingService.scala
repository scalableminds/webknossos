package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json._
import scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import java.util.UUID

import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

trait TracingService[T <: GeneratedMessage with Message[T]]
    extends KeyValueStoreImplicits
    with FoxImplicits
    with LazyLogging
    with ColorGenerator
    with BoundingBoxMerger {

  val handledGroupCacheExpiry: FiniteDuration = 5 minutes

  def tracingType: TracingType

  def tracingStore: FossilDBClient

  def temporaryTracingStore: TemporaryTracingStore[T]

  def temporaryTracingIdStore: RedisTemporaryStore

  def tracingMigrationService: TracingMigrationService[T]

  val handledGroupIdStore: RedisTemporaryStore

  val uncommittedUpdatesStore: RedisTemporaryStore

  implicit def tracingCompanion: GeneratedMessageCompanion[T]

  implicit val updateActionJsonFormat: Format[UpdateAction[T]]

  // this should be longer than maxCacheTime in webknossos/AnnotationStore
  // so that the references saved there remain valid throughout their life
  private val temporaryStoreTimeout = 70 minutes

  // the information that a tracing is/was temporary needs to be stored longer
  // to provide useful error messages to the user if the temporary tracing is no longer present
  private val temporaryIdStoreTimeout = 10 days

  def currentVersion(tracingId: String): Fox[Long]

  def currentVersion(tracing: T): Long

  def transactionBatchKey(tracingId: String,
                          transactionidOpt: Option[String],
                          transactionGroupindexOpt: Option[Int],
                          version: Long) =
    s"transactionBatch___${tracingId}___${transactionidOpt}___${transactionGroupindexOpt}___$version"

  protected def temporaryIdKey(tracingId: String) =
    s"temporaryTracingId___$tracingId"

  def currentUncommittedVersion(tracingId: String, transactionIdOpt: Option[String]): Fox[Option[Long]] =
    transactionIdOpt match {
      case Some(_) =>
        for {
          keys <- uncommittedUpdatesStore.keys(s"transactionBatch___${tracingId}___${transactionIdOpt}___*")
        } yield if (keys.isEmpty) None else Some(keys.flatMap(versionFromTransactionBatchKey).max)
      case _ => Fox.successful(None)
    }

  private def versionFromTransactionBatchKey(key: String) = {
    val pattern = """transactionBatch___(.*)___(.*)___(.*)___(\d+)""".r
    pattern.findFirstMatchIn(key).map {
      _.group(4).toLong
    }
  }

  private def patternFor(tracingId: String, transactionIdOpt: Option[String]) =
    s"transactionBatch___${tracingId}___${transactionIdOpt}___*"

  def saveUncommitted(tracingId: String,
                      transactionIdOpt: Option[String],
                      transactionGroupindexOpt: Option[Int],
                      version: Long,
                      updateGroup: UpdateActionGroup[T],
                      expiry: FiniteDuration): Fox[Unit] =
    uncommittedUpdatesStore.insert(transactionBatchKey(tracingId, transactionIdOpt, transactionGroupindexOpt, version),
                                   Json.toJson(updateGroup).toString(),
                                   Some(expiry))

  def getAllUncommittedFor(tracingId: String, transactionId: Option[String]): Fox[List[UpdateActionGroup[T]]] =
    for {
      raw: Seq[String] <- uncommittedUpdatesStore.findAllConditional(patternFor(tracingId, transactionId))
      parsed: Seq[UpdateActionGroup[T]] = raw.flatMap(itemAsString =>
        JsonHelper.jsResultToOpt(Json.parse(itemAsString).validate[UpdateActionGroup[T]]))
    } yield parsed.toList.sortBy(_.version)

  def removeAllUncommittedFor(tracingId: String, transactionId: Option[String]): Fox[Unit] =
    uncommittedUpdatesStore.removeAllConditional(patternFor(tracingId, transactionId))

  def migrateTracing(tracingFox: Fox[T], tracingId: String): Fox[T] =
    tracingMigrationService.migrateTracing(tracingFox).flatMap {
      case (tracing, hasChanged) =>
        if (hasChanged)
          save(tracing, Some(tracingId), currentVersion(tracing)).map(_ => tracing)
        else
          Fox.successful(tracing)
    }

  def handleUpdateGroup(tracingId: String, updateGroup: UpdateActionGroup[T], previousVersion: Long): Fox[_]

  def applyPendingUpdates(tracing: T, tracingId: String, targetVersion: Option[Long]): Fox[T] = Fox.successful(tracing)

  def find(tracingId: String,
           version: Option[Long] = None,
           useCache: Boolean = true,
           applyUpdates: Boolean = false): Fox[T] = {
    val tracingFox = tracingStore.get(tracingId, version)(fromProto[T]).map(_.value)
    tracingFox.flatMap { tracing =>
      val updatedTracing = if (applyUpdates) {
        applyPendingUpdates(tracing, tracingId, version)
      } else {
        Fox.successful(tracing)
      }
      migrateTracing(updatedTracing, tracingId)
    }.orElse {
      if (useCache)
        temporaryTracingStore.find(tracingId)
      else
        tracingFox
    }
  }

  def findMultiple(selectors: List[Option[TracingSelector]],
                   useCache: Boolean = true,
                   applyUpdates: Boolean = false): Fox[List[Option[T]]] =
    Fox.combined {
      selectors.map {
        case Some(selector) => find(selector.tracingId, selector.version, useCache, applyUpdates).map(Some(_))
        case None           => Fox.successful(None)
      }
    }

  def generateTracingId: String = UUID.randomUUID.toString

  def save(tracing: T, tracingId: Option[String], version: Long, toCache: Boolean = false): Fox[String] = {
    val id = tracingId.getOrElse(generateTracingId)
    if (toCache) {
      temporaryTracingStore.insert(id, tracing, Some(temporaryStoreTimeout))
      temporaryTracingIdStore.insert(temporaryIdKey(id), "", Some(temporaryIdStoreTimeout))
      Fox.successful(id)
    } else {
      tracingStore.put(id, version, tracing).map(_ => id)
    }
  }

  def handledGroupKey(tracingId: String, transactionId: String, version: Long) =
    s"handledGroup___${tracingId}___${transactionId}___$version"

  def saveToHandledGroupIdStore(tracingId: String, transactionIdOpt: Option[String], version: Long): Fox[Unit] =
    transactionIdOpt match {
      case Some(transactionId) =>
        val key = handledGroupKey(tracingId, transactionId, version)
        handledGroupIdStore.insert(key, "()", Some(handledGroupCacheExpiry))
      case _ =>
        Fox.successful(())
    }

  def handledGroupIdStoreContains(tracingId: String, transactionId: String, version: Long): Fox[Boolean] =
    handledGroupIdStore.contains(handledGroupKey(tracingId, transactionId, version))

  def merge(tracings: Seq[T]): T

  def remapTooLargeTreeIds(tracing: T): T = tracing

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[T],
                      newId: String,
                      newTracing: T,
                      toCache: Boolean): Fox[Unit]

}
