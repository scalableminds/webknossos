/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.AccessTokenService
import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import com.scalableminds.braingames.datastore.tracings.volume.{VolumeTracingService, VolumeUpdateAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingController @Inject()(
                                         volumeTracingService: VolumeTracingService,
                                         dataSourceRepository: DataSourceRepository,
                                         tracingDataStore: TracingDataStore,
                                         val accessTokenService: AccessTokenService,
                                         val messagesApi: MessagesApi
                                       ) extends TokenSecuredController {

  implicit val volumeDataStore = tracingDataStore.volumeData

  def create(dataSetName: String) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          dataSource <- dataSourceRepository.findUsableByName(dataSetName).toFox ?~> Messages("dataSource.notFound")
        } yield {
          val initialContent = request.body.asRaw.map(_.asFile)
          val tracing = volumeTracingService.create(dataSource, initialContent)
          Ok(Json.toJson(tracing))
        }
      }
    }
  }

  def update(dataSetName: String, tracingId: String) = TokenSecuredAction(dataSetName, tracingId).async(validateJson[List[VolumeUpdateAction]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- volumeTracingService.find(tracingId) ?~> Messages("tracing.notFound")
          _ <- volumeTracingService.update(tracing, request.body)
        } yield {
          Ok
        }
      }
    }
  }

  def download(dataSetName: String, tracingId: String) = TokenSecuredAction(dataSetName, tracingId).async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- volumeTracingService.find(tracingId) ?~> Messages("tracing.notFound")
        } yield {
          Ok.chunked(volumeTracingService.download(tracing))
        }
      }
    }
  }
}
