/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.tracings.skeleton._
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

class SkeletonTracingController @Inject()(
                                           val tracingService: SkeletonTracingService,
                                           val dataSourceRepository: DataSourceRepository,
                                           val messagesApi: MessagesApi
                                       ) extends TracingController[SkeletonTracing] {

  implicit val tracingFormat = SkeletonTracing.jsonFormat

  def mergedFromContents(persist: Boolean) = Action.async(validateJson[List[SkeletonTracing]]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracings = request.body
        val mergedTracing = tracingService.merge(tracings)
        tracingService.save(mergedTracing, toCache = !persist).map { _ =>
          Ok(Json.toJson(TracingReference(mergedTracing.id, TracingType.skeleton)))
        }
      }
    }
  }

  def mergedFromIds(persist: Boolean) = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- tracingService.findMultiple(request.body, applyUpdates = true) ?~> Messages("tracing.notFound")
          merged = tracingService.merge(tracings)
          _ <- tracingService.save(merged, toCache = !persist)
        } yield {
          Ok(Json.toJson(TracingReference(merged.id, TracingType.skeleton)))
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[SkeletonUpdateActionGroup]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId, useCache = false) ?~> Messages("tracing.notFound")
          _ <- tracingService.saveUpdates(tracingId, request.body)
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
          tracing <- tracingService.find(tracingId, version, applyUpdates = true) ?~> Messages("tracing.notFound")
          newTracing <- tracingService.duplicate(tracing)
        } yield {
          Ok(Json.toJson(TracingReference(newTracing.id, TracingType.skeleton)))
        }
      }
    }
  }
}
