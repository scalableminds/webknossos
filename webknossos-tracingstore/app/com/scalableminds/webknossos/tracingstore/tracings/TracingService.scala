package com.scalableminds.webknossos.tracingstore.tracings

import java.util.UUID

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.storage.TemporaryStore
import com.scalableminds.webknossos.tracingstore.RedisTemporaryStore
import com.scalableminds.webknossos.tracingstore.SkeletonTracing.SkeletonTracing
import com.scalableminds.webknossos.tracingstore.VolumeTracing.VolumeTracing
import scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Reads

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

trait TracingService[T <: GeneratedMessage with Message[T]]
    extends KeyValueStoreImplicits
    with FoxImplicits
    with LazyLogging {

  val handledGroupCacheExpiry: FiniteDuration = 5 minutes

  def tracingType: TracingType.Value

  def tracingStore: FossilDBClient

  def temporaryTracingStore: TemporaryTracingStore[T]

  val handledGroupCache: TemporaryStore[(String, String, Long), Unit]

  val uncommittedUpdatesStore: RedisTemporaryStore[UpdateActionGroup[T]]

  implicit def tracingCompanion: GeneratedMessageCompanion[T]

  implicit val updateActionReads: Reads[UpdateAction[T]]

  // this should be longer than maxCacheTime in webknossos/AnnotationStore
  // so that the references saved there remain valid throughout their life
  private val temporaryStoreTimeout = 10 minutes

  def currentVersion(tracingId: String): Fox[Long]

  def transactionBatchKey(tracingId: String,
                          transactionidOpt: Option[String],
                          transactionGroupindexOpt: Option[Int],
                          version: Long) =
    s"transactionBatch___${tracingId}___${transactionidOpt}___${transactionGroupindexOpt}___$version"

  def currentUncommittedVersion(tracingId: String, transactionIdOpt: Option[String]): Option[Long] =
    transactionIdOpt.flatMap { transactionId =>
      val keys =
        uncommittedUpdatesStore.keys(s"transactionBatch___${tracingId}___${transactionIdOpt}___*")
      if (keys.isEmpty) None else Some(keys.flatMap(versionFromTransactionBatchKey).max)
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
                      expiry: FiniteDuration): Boolean =
    uncommittedUpdatesStore.insert(transactionBatchKey(tracingId, transactionIdOpt, transactionGroupindexOpt, version),
                                   updateGroup,
                                   Some(expiry))

  def getAllUncommittedFor(tracingId: String, transactionId: Option[String]): List[UpdateActionGroup[T]] =
    uncommittedUpdatesStore.findAllConditional(patternFor(tracingId, transactionId)).toList.sortBy(_.version)

  def removeAllUncommittedFor(tracingId: String, transactionId: Option[String]): Seq[Long] =
    uncommittedUpdatesStore.removeAllConditional(patternFor(tracingId, transactionId))

  def handleUpdateGroup(tracingId: String, updateGroup: UpdateActionGroup[T], previousVersion: Long): Fox[_]

  def applyPendingUpdates(tracing: T, tracingId: String, targetVersion: Option[Long]): Fox[T] = Fox.successful(tracing)

  def find(tracingId: String,
           version: Option[Long] = None,
           useCache: Boolean = true,
           applyUpdates: Boolean = false): Fox[T] = {
    val tracingFox = tracingStore.get(tracingId, version)(fromProto[T]).map(_.value)
    tracingFox.flatMap { tracing =>
      if (applyUpdates) {
        applyPendingUpdates(tracing, tracingId, version)
      } else {
        Fox.successful(tracing)
      }
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

  def save(tracing: T, tracingId: Option[String], version: Long, toCache: Boolean = false): Fox[String] = {
    val id = tracingId.getOrElse(UUID.randomUUID.toString)
    if (toCache) {
      temporaryTracingStore.insert(id, tracing, Some(temporaryStoreTimeout))
      Fox.successful(id)
    } else {
      tracingStore.put(id, version, tracing).map(_ => id)
    }
  }

  def saveToHandledGroupCache(tracingId: String, version: Long, requestIdOpt: Option[String]): Unit =
    requestIdOpt.foreach { requestId =>
      handledGroupCache.insert((requestId, tracingId, version), (), Some(handledGroupCacheExpiry))
    }

  def handledGroupCacheContains(requestId: String, tracingId: String, version: Long): Boolean =
    handledGroupCache.contains(requestId, tracingId, version)
}
