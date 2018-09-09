package com.scalableminds.webknossos.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracings}
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, DataSourceRepository, UserAccessRequest, WebKnossosServer}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingService
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

class VolumeTracingController @Inject()(
                                         val tracingService: VolumeTracingService,
                                         val dataSourceRepository: DataSourceRepository,
                                         val webKnossosServer: WebKnossosServer,
                                         val accessTokenService: AccessTokenService,
                                         tracingDataStore: TracingDataStore
                                       ) extends TracingController[VolumeTracing, VolumeTracings] {

  implicit val tracingsCompanion = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings = VolumeTracings(tracings)

  implicit def unpackMultiple(tracings: VolumeTracings): List[VolumeTracing] = tracings.tracings.toList

  def initialData(tracingId: String) = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            dataSource <- dataSourceRepository.findUsableByName(tracing.dataSetName) ?~> Messages("dataSet.notFound")
            _ <- tracingService.initializeWithData(tracingId, tracing, dataSource, initialData)
          } yield Ok(Json.toJson(tracingId))
        }
      }
  }

  def getData(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
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


  def duplicate(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            newId <- tracingService.duplicate(tracingId, tracing)
          } yield {
            Ok(Json.toJson(newId))
          }
        }
      }
    }
  }
}
