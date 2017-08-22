/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.datastore.tracings

import java.util.UUID

import com.scalableminds.braingames.binary.storage.kvstore.VersionedKeyValueStore
import com.scalableminds.braingames.datastore.temporarystore.TemporaryStore
import com.scalableminds.braingames.datastore.tracings.skeleton.TracingSelector
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Empty, Failure, Full}
import play.api.libs.json.Format

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.reflect.ClassTag

trait TracingService[T <: Tracing] extends FoxImplicits {

  implicit val tracingFormat: Format[T]

  implicit val tag: ClassTag[T]

  def tracingType: TracingType.Value

  def tracingStore: VersionedKeyValueStore

  // this should be longer than maxCacheTime in webknossos//AnnotationStore so that the references saved there remain valid throughout their life
  private val temporaryStoreTimeout = 10 minutes

  def createNewId: String =
    UUID.randomUUID.toString

  def applyPendingUpdates(tracing: T, targetVersion: Option[Long]): Fox[T] =
    Fox.successful(tracing)

  def find(tracingId: String, version: Option[Long] = None, useCache: Boolean = true, applyUpdates: Boolean = false): Fox[T] = {
    tracingStore.getJson(tracingId, version).map(_.value).flatMap { tracing =>
      if (applyUpdates)
        applyPendingUpdates(tracing, version)
      else
        Fox.successful(tracing)
    }.orElse {
      if (useCache) {
        try {
          TemporaryStore.getAs[T](tracingId)
        } catch {
          case e: NullPointerException => Fox.failure("Could not load temporary tracing")
        }
      }
      else
        Fox.empty
    }
  }

  def findMultiple(selectors: List[TracingSelector], useCache: Boolean = true, applyUpdates: Boolean = false): Fox[List[T]] = {
    Fox.combined {
      selectors.map(selector => find(selector.tracingId, selector.version, useCache, applyUpdates))
    }
  }

  def save(tracing: T, toCache: Boolean = false): Fox[Unit] = {
    find(tracing.id).futureBox.flatMap {
      case Full(_) =>
        Fox.failure("tracing ID is already in use.")
      case Empty =>
        if (toCache) {
          Fox.successful(TemporaryStore.set(tracing.id, tracing, temporaryStoreTimeout))
        } else {
          tracingStore.putJson(tracing.id, tracing.version, tracing)
        }
      case f: Failure =>
        Future.successful(f)
    }
  }
}
