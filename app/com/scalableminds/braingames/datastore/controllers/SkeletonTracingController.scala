/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.braingames.datastore.tracings.skeleton._
import com.scalableminds.braingames.datastore.tracings.skeleton.elements.SkeletonTracing
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

class SkeletonTracingController @Inject()(
                                         webKnossosServer: WebKnossosServer,
                                         skeletonTracingService: SkeletonTracingService,
                                         dataSourceRepository: DataSourceRepository,
                                         val messagesApi: MessagesApi
                                       ) extends Controller {

  def createEmpty(dataSetName: String) = Action(validateJson[CreateEmptyParameters]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracing = skeletonTracingService.create(dataSetName, request.body)
        Ok(tracing.id)
      }
    }
  }

  def createFromNml(name: String) = Action(parse.tolerantText) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- NmlParser.parse(skeletonTracingService.createNewId(), name, request.body.trim())
        } yield {
          skeletonTracingService.save(tracing)
          Ok(tracing.id)
        }
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[SkeletonUpdateActionGroup]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracing <- skeletonTracingService.find(tracingId) ?~> Messages("tracing.notFound")
          _ <- skeletonTracingService.saveUpdates(tracingId, request.body)
        } yield {
          Ok
        }
      }
    }
  }

  def get(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracingVersioned <- skeletonTracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
          updatedTracing <- skeletonTracingService.applyPendingUpdates(tracingVersioned, version)
        } yield {
          Ok(Json.toJson(updatedTracing))
        }
      }
    }
  }

  def download(tracingId: String, version: Option[Long], outfileName: String) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracingVersioned <- skeletonTracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
          updatedTracing <- skeletonTracingService.applyPendingUpdates(tracingVersioned, version)
          downloadStream <- skeletonTracingService.downloadNml(updatedTracing, dataSourceRepository)
        } yield {
          Ok.chunked(downloadStream).withHeaders(
            CONTENT_TYPE ->
              "application/octet-stream",
            CONTENT_DISPOSITION ->
              s"filename=${'"'}${outfileName}${'"'}.nml")
        }
      }
    }
  }

  def duplicate(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracingVersioned <- skeletonTracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
          updatedTracing <- skeletonTracingService.applyPendingUpdates(tracingVersioned, version)
          newTracing <- skeletonTracingService.duplicate(updatedTracing)
        } yield {
          Ok(newTracing.id)
        }
      }
    }
  }

  def createMergedFromZip() = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        val zipfile = request.body.asRaw.map(_.asFile)
        for {
          tracings <- skeletonTracingService.extractAllFromZip(zipfile)
        } yield {
          val merged = skeletonTracingService.merge(tracings)
          skeletonTracingService.save(merged)
          Ok(merged.id)
        }
      }
    }
  }


  def createMultipleFromZip() = Action.async {
    implicit request => {
      AllowRemoteOrigin {
        val zipfile = request.body.asRaw.map(_.asFile)
        val idsFox = for {
          tracings: List[SkeletonTracing] <- skeletonTracingService.extractAllFromZip(zipfile)
        } yield {
          tracings.map(skeletonTracingService.save(_))
          tracings.map(_.id)
        }
        for {
          ids <- idsFox
        } yield {
          Ok(Json.toJson(ids))
        }
      }
    }
  }

  def createMultipleFromCsv() = Action {Ok}


  def createMergedFromIds = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- skeletonTracingService.findMultipleUpdated(request.body) ?~> Messages("tracing.notFound")
        } yield {
          val merged = skeletonTracingService.merge(tracings)
          skeletonTracingService.save(merged)
          Ok(merged.id)
        }
      }
    }
  }

  def getMerged = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- skeletonTracingService.findMultipleUpdated(request.body) ?~> Messages("tracing.notFound")
        } yield {
          val merged = skeletonTracingService.merge(tracings)
          Ok(Json.toJson(merged))
        }
      }
    }
  }

  def downloadMultiple = Action.async(validateJson[DownloadMultipleParameters]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          zip <- skeletonTracingService.downloadMultiple(request.body, dataSourceRepository)
        } yield {
          Ok.sendFile(zip.file)
        }
      }
    }
  }

}
