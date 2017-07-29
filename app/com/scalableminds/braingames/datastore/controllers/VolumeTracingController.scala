/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import java.io.File

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.AccessTokenService
import com.scalableminds.braingames.datastore.tracings.TracingDataStore
import com.scalableminds.braingames.datastore.tracings.volume.{VolumeTracingService, VolumeUpdateAction}
import com.scalableminds.util.tools.Fox
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

  def createEmpty(dataSetName: String) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        create(dataSetName, None).map(tracing => Ok(Json.toJson(tracing)))
      }
    }
  }

  def createFromZip(dataSetName: String) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        val initialContent = request.body.asRaw.map(_.asFile)
        create(dataSetName, initialContent).map(tracing => Ok(Json.toJson(tracing)))
      }
    }
  }

  def get(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- volumeTracingService.find(tracingId) ?~> Messages("tracing.notFound")
        } yield {
          Ok(Json.toJson(tracing))
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[VolumeUpdateAction]]) {
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

  def download(tracingId: String, version: Option[Long]) = Action.async {
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

  private def create(dataSetName: String, initialContent: Option[File]): Fox[String] = {
    for {
      dataSource <- dataSourceRepository.findUsableByName(dataSetName).toFox ?~> Messages("dataSource.notFound")
    } yield {
      volumeTracingService.create(dataSource, initialContent).id
    }
  }
}
