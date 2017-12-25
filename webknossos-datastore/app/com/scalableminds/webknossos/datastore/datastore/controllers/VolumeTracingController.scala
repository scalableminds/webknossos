/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.webknossos.datastore.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.binary.helpers.DataSourceRepository
import com.scalableminds.webknossos.datastore.datastore.VolumeTracing.{VolumeTracing, VolumeTracings}
import com.scalableminds.webknossos.datastore.datastore.services.{AccessTokenService, UserAccessRequest, WebKnossosServer}
import com.scalableminds.webknossos.datastore.datastore.tracings._
import com.scalableminds.webknossos.datastore.datastore.tracings.volume.VolumeTracingService
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingController @Inject()(
                                         val tracingService: VolumeTracingService,
                                         val dataSourceRepository: DataSourceRepository,
                                         val webKnossosServer: WebKnossosServer,
                                         val accessTokenService: AccessTokenService,
                                         tracingDataStore: TracingDataStore,
                                         val messagesApi: MessagesApi
                                       ) extends TracingController[VolumeTracing, VolumeTracings] {

  implicit val tracingsCompanion = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings = VolumeTracings(tracings)

  implicit def unpackMultiple(tracings: VolumeTracings): List[VolumeTracing] = tracings.tracings.toList

  def initialData(tracingId: String) = TokenSecuredAction(UserAccessRequest.webknossos).async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
          dataSource <- dataSourceRepository.findUsableByName(tracing.dataSetName) ?~> Messages("dataSet.notFound")
          _ <- tracingService.initializeWithData(tracingId, tracing, dataSource, initialData)
        } yield Ok(Json.toJson(TracingReference(tracingId, TracingType.volume)))
      }
  }

  def getData(tracingId: String, version: Option[Long]) = TokenSecuredAction(UserAccessRequest.webknossos).async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
        } yield {
          Ok.chunked(tracingService.data(tracingId, tracing))
        }
      }
    }
  }
}
