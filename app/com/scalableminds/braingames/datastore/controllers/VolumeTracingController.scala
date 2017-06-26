/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.{TracingContentService, WebKnossosServer}
import com.scalableminds.braingames.datastore.tracings.volume.{VolumeTracingService, VolumeUpdateAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingController @Inject()(
                                         webKnossosServer: WebKnossosServer,
                                         volumeTracingService: VolumeTracingService,
                                         dataSourceRepository: DataSourceRepository,
                                         tracingRepository: TracingContentService,
                                         val messagesApi: MessagesApi
                                       ) extends Controller {

  def create(dataSetName: String) = Action.async {
    implicit request => {
      for {
        dataSource <- dataSourceRepository.findUsableByName(dataSetName).toFox ?~> Messages("dataSource.notFound")
      } yield {
        val tracing = volumeTracingService.create(dataSource)
        Ok(Json.toJson(tracing))
      }
    }
  }

  def info(annotationId: String) = Action.async {
    implicit request => {
      for {
        tracing <- tracingRepository.findVolumeTracing(annotationId) ?~> Messages("tracing.notFound")
        tracingInfo <- volumeTracingService.info(tracing)
      } yield {
        Ok(tracingInfo)
      }
    }
  }

  def update(annotationId: String) = Action.async(validateJson[List[VolumeUpdateAction]]) {
    implicit request => {
      for {
        tracing <- tracingRepository.findVolumeTracing(annotationId) ?~> Messages("tracing.notFound")
        _ <- volumeTracingService.update(tracing, request.body)
      } yield {
        Ok
      }
    }
  }

  def download(annotationId: String, version: Long) = Action {
    implicit request => {
      Ok
    }
  }

  def duplicate(annotationId: String, version: Long) = Action {
    implicit request => {
      Ok
    }
  }
}
