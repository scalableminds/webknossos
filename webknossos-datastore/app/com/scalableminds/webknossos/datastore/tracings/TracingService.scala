/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.webknossos.datastore.tracings

import java.util.UUID

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.trueaccord.scalapb.{GeneratedMessage, GeneratedMessageCompanion, Message}
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.Reads

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

trait TracingService[T <: GeneratedMessage with Message[T]] extends KeyValueStoreImplicits with FoxImplicits with LazyLogging {

  def tracingType: TracingType.Value

  def tracingStore: FossilDBClient

  def temporaryTracingStore: TemporaryTracingStore[T]

  implicit def tracingCompanion: GeneratedMessageCompanion[T]

  implicit val updateActionReads: Reads[UpdateAction[T]]

  // this should be longer than maxCacheTime in webknossos/AnnotationStore
  // so that the references saved there remain valid throughout their life
  private val temporaryStoreTimeout = 10 minutes

  def currentVersion(tracingId: String): Fox[Long]

  def handleUpdateGroup(tracingId: String, updateGroup: UpdateActionGroup[T]): Fox[_]

  def applyPendingUpdates(tracing: T, tracingId: String, targetVersion: Option[Long]): Fox[T] = Fox.successful(tracing)

  def find(tracingId: String, version: Option[Long] = None, useCache: Boolean = true, applyUpdates: Boolean = false): Fox[T] = {
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

  def findMultiple(selectors: List[TracingSelector], useCache: Boolean = true, applyUpdates: Boolean = false): Fox[List[T]] = {
    Fox.combined {
      selectors.map(selector => find(selector.tracingId, selector.version, useCache, applyUpdates))
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
}
