/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
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
                                           val tracingService: SkeletonTracingService,
                                           val dataSourceRepository: DataSourceRepository,
                                           val messagesApi: MessagesApi
                                       ) extends TracingController[SkeletonTracing] {

  implicit val tracingFormat = SkeletonTracing.jsonFormat

  def mergedFromContents(persist: Boolean) = Action(validateJson[List[SkeletonTracing]]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracings = request.body
        val mergedTracing = tracingService.merge(tracings)
        tracingService.save(mergedTracing)
        Ok(Json.toJson(TracingReference(mergedTracing.id, TracingType.skeleton)))
      }
    }
  }

  def mergedFromIds(persist: Boolean) = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- tracingService.findMultipleUpdated(request.body) ?~> Messages("tracing.notFound")
        } yield {
          val merged = tracingService.merge(tracings)
          tracingService.save(merged)
          Ok(Json.toJson(TracingReference(merged.id, TracingType.skeleton)))
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[SkeletonUpdateActionGroup]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
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
          tracingVersioned <- tracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
          updatedTracing <- tracingService.applyPendingUpdates(tracingVersioned, version)
        } yield {
          val newTracing = tracingService.duplicate(updatedTracing)
          Ok(Json.toJson(TracingReference(newTracing.id, TracingType.skeleton)))
        }
      }
    }
  }

}
