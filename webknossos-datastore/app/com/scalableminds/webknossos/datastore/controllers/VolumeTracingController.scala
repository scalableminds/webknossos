package com.scalableminds.webknossos.datastore.controllers

import akka.stream.scaladsl.Source
import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.VolumeTracing.{VolumeTracing, VolumeTracings}
import com.scalableminds.webknossos.datastore.models.datasource.DataSourceId
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, DataSourceRepository, UserAccessRequest, WebKnossosServer}
import com.scalableminds.webknossos.datastore.tracings._
import com.scalableminds.webknossos.datastore.tracings.volume.VolumeTracingService
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.iteratee.Enumerator
import play.api.libs.iteratee.streams.IterateeStreams
import play.api.libs.json.Json
import play.api.mvc.PlayBodyParsers

import scala.concurrent.ExecutionContext

class VolumeTracingController @Inject()(val tracingService: VolumeTracingService,
                                        val dataSourceRepository: DataSourceRepository,
                                        val webKnossosServer: WebKnossosServer,
                                        val accessTokenService: AccessTokenService,
                                        tracingDataStore: TracingDataStore)
                                       (implicit val ec: ExecutionContext,
                                        val bodyParsers: PlayBodyParsers)
  extends TracingController[VolumeTracing, VolumeTracings] {

  implicit val tracingsCompanion = VolumeTracings

  implicit def packMultiple(tracings: List[VolumeTracing]): VolumeTracings = VolumeTracings(tracings)

  implicit def unpackMultiple(tracings: VolumeTracings): List[VolumeTracing] = tracings.tracings.toList

  def initialData(organizationName: String, tracingId: String) = Action.async {
    implicit request =>
      accessTokenService.validateAccess(UserAccessRequest.webknossos) {
        AllowRemoteOrigin {
          for {
            initialData <- request.body.asRaw.map(_.asFile) ?~> Messages("zipFile.notFound")
            tracing <- tracingService.find(tracingId) ?~> Messages("tracing.notFound")
            dataSource <- dataSourceRepository.findUsable(DataSourceId(tracing.dataSetName, organizationName)) ?~> Messages("dataSet.notFound")
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
            val enumerator: Enumerator[Array[Byte]] = tracingService.data(tracingId, tracing)
            Ok.chunked(Source.fromPublisher(IterateeStreams.enumeratorToPublisher(enumerator)))
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
