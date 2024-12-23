package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.tracingstore.TracingStoreRedisStore
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats
import com.typesafe.scalalogging.LazyLogging
import play.api.http.Status.CONFLICT
import net.liftweb.common.Box
import play.api.i18n.MessagesProvider
import play.api.libs.json._
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

object TracingIds {
  val dummyTracingId: String = "dummyTracingId"
}

trait TracingService[T <: GeneratedMessage]
    extends KeyValueStoreImplicits
    with FoxImplicits
    with LazyLogging
    with ColorGenerator
    with BoundingBoxMerger {

  implicit val ec: ExecutionContext

  def tracingType: TracingType

  def tracingStore: FossilDBClient

  def temporaryTracingStore: TemporaryTracingStore[T]

  def temporaryTracingIdStore: TracingStoreRedisStore

  def tracingMigrationService: TracingMigrationService[T]

  def dummyTracing: T

  val handledGroupIdStore: TracingStoreRedisStore

  val uncommittedUpdatesStore: TracingStoreRedisStore

  implicit def tracingCompanion: GeneratedMessageCompanion[T]

  implicit val updateActionJsonFormat: Format[UpdateAction[T]]

  // this should be longer than maxCacheTime in webknossos/AnnotationStore
  // so that the references saved there remain valid throughout their life
  private val temporaryStoreTimeout = 70 minutes

  // the information that a tracing is/was temporary needs to be stored longer
  // to provide useful error messages to the user if the temporary tracing is no longer present
  private val temporaryIdStoreTimeout = 10 days

  private val handledGroupCacheExpiry: FiniteDuration = 24 hours

  def currentVersion(tracingId: String): Fox[Long]

  def currentVersion(tracing: T): Long

  private def transactionGroupKey(tracingId: String, transactionId: String, transactionGroupIndex: Int, version: Long) =
    s"transactionGroup___${tracingId}___${transactionId}___${transactionGroupIndex}___$version"

  protected def temporaryIdKey(tracingId: String) =
    s"temporaryTracingId___$tracingId"

  private def patternFor(tracingId: String, transactionId: String) =
    s"transactionGroup___${tracingId}___${transactionId}___*"

  def saveUncommitted(tracingId: String,
                      transactionId: String,
                      transactionGroupIndex: Int,
                      version: Long,
                      updateGroup: UpdateActionGroup[T],
                      expiry: FiniteDuration): Fox[Unit] =
    for {
      _ <- Fox.runIf(transactionGroupIndex > 0)(
        Fox.assertTrue(
          uncommittedUpdatesStore.contains(transactionGroupKey(
            tracingId,
            transactionId,
            transactionGroupIndex - 1,
            version))) ?~> s"Incorrect transaction index. Got: $transactionGroupIndex but ${transactionGroupIndex - 1} does not exist" ~> CONFLICT)
      _ <- uncommittedUpdatesStore.insert(transactionGroupKey(tracingId, transactionId, transactionGroupIndex, version),
                                          Json.toJson(updateGroup).toString(),
                                          Some(expiry))
    } yield ()

  def getAllUncommittedFor(tracingId: String, transactionId: String): Fox[List[UpdateActionGroup[T]]] =
    for {
      raw: Seq[String] <- uncommittedUpdatesStore.findAllConditional(patternFor(tracingId, transactionId))
      parsed: Seq[UpdateActionGroup[T]] = raw.flatMap(itemAsString =>
        JsonHelper.jsResultToOpt(Json.parse(itemAsString).validate[UpdateActionGroup[T]]))
    } yield parsed.toList.sortBy(_.transactionGroupIndex)

  def removeAllUncommittedFor(tracingId: String, transactionId: String): Fox[Unit] =
    uncommittedUpdatesStore.removeAllConditional(patternFor(tracingId, transactionId))

  private def migrateTracing(tracingFox: Fox[T], tracingId: String): Fox[T] =
    tracingMigrationService.migrateTracing(tracingFox).flatMap {
      case (tracing, hasChanged) =>
        if (hasChanged)
          save(tracing, Some(tracingId), currentVersion(tracing)).map(_ => tracing)
        else
          Fox.successful(tracing)
    }

  def handleUpdateGroup(tracingId: String,
                        updateGroup: UpdateActionGroup[T],
                        previousVersion: Long,
                        userToken: Option[String]): Fox[_]

  def applyPendingUpdates(tracing: T, tracingId: String, targetVersion: Option[Long]): Fox[T] = Fox.successful(tracing)

  def find(tracingId: String,
           version: Option[Long] = None,
           useCache: Boolean = true,
           applyUpdates: Boolean = false): Fox[T] =
    if (tracingId == TracingIds.dummyTracingId)
      Fox.successful(dummyTracing)
    else {
      val tracingFox = tracingStore.get(tracingId, version)(fromProtoBytes[T]).map(_.value)
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

  private def handledGroupKey(tracingId: String, transactionId: String, version: Long, transactionGroupIndex: Int) =
    s"handledGroup___${tracingId}___${transactionId}___${version}___$transactionGroupIndex"

  def saveToHandledGroupIdStore(tracingId: String,
                                transactionId: String,
                                version: Long,
                                transactionGroupIndex: Int): Fox[Unit] = {
    val key = handledGroupKey(tracingId, transactionId, version, transactionGroupIndex)
    handledGroupIdStore.insert(key, "()", Some(handledGroupCacheExpiry))
  }

  def handledGroupIdStoreContains(tracingId: String,
                                  transactionId: String,
                                  version: Long,
                                  transactionGroupIndex: Int): Fox[Boolean] =
    handledGroupIdStore.contains(handledGroupKey(tracingId, transactionId, version, transactionGroupIndex))

  def merge(tracings: Seq[T], mergedVolumeStats: MergedVolumeStats, newEditableMappingIdOpt: Option[String]): Box[T]

  def remapTooLargeTreeIds(tracing: T): T = tracing

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[T],
                      newId: String,
                      newVersion: Long,
                      toCache: Boolean,
                      userToken: Option[String])(implicit mp: MessagesProvider): Fox[MergedVolumeStats]

  def mergeEditableMappings(tracingsWithIds: List[(T, String)], userToken: Option[String]): Fox[String]
}
