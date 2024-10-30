package com.scalableminds.webknossos.tracingstore.tracings

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.tracingstore.{TSRemoteWebknossosClient, TracingStoreRedisStore}
import com.scalableminds.webknossos.tracingstore.tracings.TracingType.TracingType
import com.scalableminds.webknossos.tracingstore.tracings.volume.MergedVolumeStats
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import play.api.i18n.MessagesProvider
import scalapb.{GeneratedMessage, GeneratedMessageCompanion}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration._

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

  def remoteWebknossosClient: TSRemoteWebknossosClient

  def tracingMigrationService: TracingMigrationService[T]

  implicit def tracingCompanion: GeneratedMessageCompanion[T]

  // this should be longer than maxCacheTime in webknossos/AnnotationStore
  // so that the references saved there remain valid throughout their life
  private val temporaryStoreTimeout = 70 minutes

  // the information that a tracing is/was temporary needs to be stored longer
  // to provide useful error messages to the user if the temporary tracing is no longer present
  private val temporaryIdStoreTimeout = 10 days

  protected def temporaryIdKey(tracingId: String) =
    s"temporaryTracingId___$tracingId"

  /* // TODO ? add this to migration?
  private def migrateTracing(tracingFox: Fox[T], tracingId: String): Fox[T] =
    tracingMigrationService.migrateTracing(tracingFox).flatMap {
      case (tracing, hasChanged) =>
        if (hasChanged)
          save(tracing, Some(tracingId), currentVersion(tracing)).map(_ => tracing)
        else
          Fox.successful(tracing)
    }
   */

  def save(tracing: T, tracingId: Option[String], version: Long, toCache: Boolean = false): Fox[String] = {
    val id = tracingId.getOrElse(TracingId.generate)
    if (toCache) {
      temporaryTracingStore.insert(id, tracing, Some(temporaryStoreTimeout))
      temporaryTracingIdStore.insert(temporaryIdKey(id), "", Some(temporaryIdStoreTimeout))
      Fox.successful(id)
    } else {
      tracingStore.put(id, version, tracing).map(_ => id)
    }
  }

  def remapTooLargeTreeIds(tracing: T): T = tracing

  def mergeVolumeData(tracingSelectors: Seq[TracingSelector],
                      tracings: Seq[T],
                      newId: String,
                      newVersion: Long,
                      toCache: Boolean)(implicit mp: MessagesProvider, tc: TokenContext): Fox[MergedVolumeStats]

  def mergeEditableMappings(newTracingId: String, tracingsWithIds: List[(T, String)])(
      implicit tc: TokenContext): Fox[Unit]
}
