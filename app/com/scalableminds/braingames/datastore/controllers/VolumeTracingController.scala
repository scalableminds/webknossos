/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.braingames.datastore.tracings.volume.{VolumeTracingService, VolumeUpdateActionGroup}
import com.scalableminds.braingames.datastore.tracings.{TracingDataStore, TracingReference, TracingType}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingController @Inject()(
                                         val tracingService: VolumeTracingService,
                                         val dataSourceRepository: DataSourceRepository,
                                         val webKnossosServer: WebKnossosServer,
                                         tracingDataStore: TracingDataStore,
                                         val messagesApi: MessagesApi
                                       ) extends TracingController[VolumeTracing] {

  def initialData(tracingId: String) = Action.async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          _ <- tracingService.initializeWithData(tracing, initialData)
        } yield Ok(Json.toJson(TracingReference(tracingId, TracingType.volume)))
      }
  }

  def update(tracingId: String) = Action.async(validateJson[List[VolumeUpdateActionGroup]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          //_ <- withAuthorizedUpdate(tracingId, tracing.version, request.body)(updates => volumeTracingService.update(tracing, updates.actions))
        } yield {
          Ok
        }
      }
    }
  }

  def getData(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
        } yield {
          Ok.chunked(tracingService.data(tracing))
        }
      }
    }
  }
}
