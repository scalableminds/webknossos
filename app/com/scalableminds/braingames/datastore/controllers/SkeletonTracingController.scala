/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import com.scalableminds.braingames.datastore.tracings.skeleton._
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.util.tools.Fox
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.collection.immutable
import scala.concurrent.ExecutionContext.Implicits.global

class SkeletonTracingController @Inject()(
                                         webKnossosServer: WebKnossosServer,
                                         skeletonTracingService: SkeletonTracingService,
                                         dataSourceRepository: DataSourceRepository,
                                         val messagesApi: MessagesApi
                                       ) extends Controller {

  def save = Action(validateJson[SkeletonTracing]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracing = request.body
        skeletonTracingService.save(tracing)
        Ok(Json.toJson(TracingReference(tracing.id, TracingType.skeleton)))
      }
    }
  }

  def saveMultiple = Action(validateJson[List[SkeletonTracing]]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracings = request.body
        tracings.foreach(skeletonTracingService.save)
        val references = tracings.map(t => TracingReference(t.id, TracingType.skeleton))
        Ok(Json.toJson(references))
      }
    }
  }

  def mergedFromContents(persist: Boolean) = Action(validateJson[List[SkeletonTracing]]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracings = request.body
        val mergedTracing = skeletonTracingService.merge(tracings)
        skeletonTracingService.save(mergedTracing)
        Ok(Json.toJson(TracingReference(mergedTracing.id, TracingType.skeleton)))
      }
    }
  }

  def mergedFromIds(persist: Boolean) = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- skeletonTracingService.findMultipleUpdated(request.body) ?~> Messages("tracing.notFound")
        } yield {
          val merged = skeletonTracingService.merge(tracings)
          skeletonTracingService.save(merged)
          Ok(Json.toJson(TracingReference(merged.id, TracingType.skeleton)))
        }
      }
    }
  }


  def get(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracingVersioned <- skeletonTracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
          updatedTracing <- skeletonTracingService.applyPendingUpdates(tracingVersioned, version)
        } yield {
          Ok(Json.toJson(updatedTracing))
        }
      }
    }
  }

  def getMultiple = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- skeletonTracingService.findMultipleUpdated(request.body) ?~> Messages("tracing.notFound")
        } yield {
          Ok(Json.toJson(tracings))
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[SkeletonUpdateActionGroup]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- skeletonTracingService.find(tracingId) ?~> Messages("tracing.notFound")
          _ <- skeletonTracingService.saveUpdates(tracingId, request.body)
        } yield {
          Ok
        }
      }
    }
  }

  def duplicate(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracingVersioned <- skeletonTracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
          updatedTracing <- skeletonTracingService.applyPendingUpdates(tracingVersioned, version)
        } yield {
          val newTracing = skeletonTracingService.duplicate(updatedTracing)
          Ok(Json.toJson(TracingReference(newTracing.id, TracingType.skeleton)))
        }
      }
    }
  }

}
