/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
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
                                         webKnossosServer: WebKnossosServer,
                                         skeletonTracingService: SkeletonTracingService,
                                         dataSourceRepository: DataSourceRepository,
                                         val messagesApi: MessagesApi
                                       ) extends Controller {

  def createFromParams(dataSetName: String) = Action(validateJson[CreateEmptyParameters]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracing = skeletonTracingService.create(dataSetName, request.body)
        Ok(Json.toJson(TracingReference(tracing.id, TracingType.skeleton)))
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
          Ok(Json.toJson(TracingReference(tracing.id, TracingType.skeleton)))
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
        } yield {
          val newTracing = skeletonTracingService.duplicate(updatedTracing)
          Ok(Json.toJson(TracingReference(newTracing.id, TracingType.skeleton)))
        }
      }
    }
  }

  def createMergedFromZip() = Action {
    implicit request => {
      AllowRemoteOrigin {
        val zipfile = request.body.asRaw.map(_.asFile)
        for {
          tracings <- skeletonTracingService.extractAllFromZip(zipfile)
        } yield {
          val merged = skeletonTracingService.merge(tracings)
          skeletonTracingService.save(merged)
          Ok(Json.toJson(TracingReference(merged.id, TracingType.skeleton)))
        }
      }
    }
  }


  def createMultipleFromZip() = Action {
    implicit request => {
      AllowRemoteOrigin {
        val zipfile = request.body.asRaw.map(_.asFile)
        for {
          tracings: List[SkeletonTracing] <- skeletonTracingService.extractAllFromZip(zipfile)
        } yield {
          tracings.foreach(skeletonTracingService.save)
          val references = tracings.map(tracing => TracingReference(tracing.id, TracingType.skeleton))
          Ok(Json.toJson(references))
        }
      }
    }
  }

  def createMultipleFromParams(dataSetName: String) = Action(validateJson[List[CreateEmptyParameters]]) {
    implicit request => {
      AllowRemoteOrigin {
        val tracings = request.body.map(params => skeletonTracingService.create(dataSetName, params))
        val references = tracings.map(tracing => TracingReference(tracing.id, TracingType.skeleton))
        Ok(Json.toJson(references))
      }
    }
  }

  def createMergedFromIds = Action.async(validateJson[List[TracingSelector]]) {
    implicit request => {
      AllowRemoteOrigin {
        for {
          tracings <- skeletonTracingService.findMultipleUpdated(request.body) ?~> Messages("tracing.notFound")
        } yield {
          val merged = skeletonTracingService.merge(tracings)
          skeletonTracingService.save(merged)
          Ok(Json.toJson(TracingReference(merged.id, TracingType.skeleton)))
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
          val merged = skeletonTracingService.merge(tracings, newId="<temporary>")
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
