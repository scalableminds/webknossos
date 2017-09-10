/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import java.util.UUID

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.braingames.datastore.tracings.skeleton._
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracingDepr
import com.scalableminds.braingames.datastore.tracings.{TracingReference, TracingType}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

class SkeletonTracingController @Inject()(
                                           val tracingService: SkeletonTracingService,
                                           val dataSourceRepository: DataSourceRepository,
                                           val webKnossosServer: WebKnossosServer,
                                           val messagesApi: MessagesApi
                                       ) extends TracingController[SkeletonTracingDepr] {

  def mergedFromContents(persist: Boolean) = Action.async(validateJson[List[SkeletonTracingDepr]]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracings = request.body
        val mergedTracing = tracingService.merge(tracings)
        val newId = UUID.randomUUID.toString
        tracingService.save(mergedTracing, newId, mergedTracing.version, toCache = !persist).map { _ =>
          Ok(Json.toJson(TracingReference(newId, TracingType.skeleton)))
        }
      }
    }
  }

  def mergedFromIds(persist: Boolean) = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- tracingService.findMultiple(request.body, applyUpdates = true) ?~> Messages("tracing.notFound")
          mergedTracing = tracingService.merge(tracings)
          newId = UUID.randomUUID.toString
          _ <- tracingService.save(mergedTracing, newId, mergedTracing.version, toCache = !persist)
        } yield {
          Ok(Json.toJson(TracingReference(newId, TracingType.skeleton)))
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
          newTracingId <- tracingService.duplicate(tracing)
        } yield {
          Ok(Json.toJson(TracingReference(newTracingId, TracingType.skeleton)))
        }
      }
    }
  }
}
