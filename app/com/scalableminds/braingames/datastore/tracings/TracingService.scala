package com.scalableminds.braingames.datastore.tracings

import java.util.UUID

import com.scalableminds.braingames.binary.storage.kvstore.{VersionedKeyValuePair, VersionedKeyValueStore}
import com.scalableminds.braingames.datastore.tracings.skeleton.TracingSelector
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Empty, Failure, Full}
import play.api.libs.json.Format

import scala.concurrent.ExecutionContext.Implicits.global

trait TracingService[T <: Tracing] extends FoxImplicits {

  implicit val tracingFormat: Format[T]

  def tracingType: TracingType.Value

  def tracingStore: VersionedKeyValueStore

  def createNewId: String =
    UUID.randomUUID.toString

  def find(tracingId: String, version: Option[Long] = None): Box[T] =
    findVersioned(tracingId, version).map(_.value)

  def findVersioned(tracingId: String, version: Option[Long] = None): Box[VersionedKeyValuePair[T]] =
    tracingStore.getJson[T](tracingId, version)

  def findUpdated(tracingId: String, version: Option[Long] = None): Box[T] =
    find(tracingId, version)

  def findMultipleUpdated(selectors: List[TracingSelector]): Fox[List[T]] =
    // TODO use Box.combined
    Fox.combined {
      selectors.map(selector => findUpdated(selector.tracingId, selector.version).toFox)
    }

  //TODO: caching
  def save(tracing: T): Box[Unit] = {
    find(tracing.id) match {
      case Full(_) =>
        Failure("tracing ID is already in use.")
      case Empty =>
        tracingStore.putJson(tracing.id, 0L, tracing)
      case f: Failure =>
        f
    }
  }


  //  def applyUpdates(tracing: T, updates: List[UpdateAction[T]]): Box[T]

//  def handleUpdateActionGroup[I](tracing: I, updates: UpdateActionGroup[T]): Box[I]
}
