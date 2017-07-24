/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.braingames.datastore.tracings.skeleton.{SkeletonTracingService, SkeletonUpdateAction, SkeletonUpdateActionGroup}
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

  def createEmpty(dataSetName: String) = Action {
    implicit request => {
      val tracing = skeletonTracingService.create(dataSetName)
      Ok(tracing.id)
    }
  }

  def createFromNml(name: String) = Action(parse.tolerantText) {
    implicit request => {
      for {
        tracing <- skeletonTracingService.createFromNML(name, request.body)
      } yield {
        Ok(tracing.id)
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[SkeletonUpdateActionGroup]]) {
    implicit request => {
      for {
        tracing <- skeletonTracingService.find(tracingId) ?~> Messages("tracing.notFound")
        _ <- skeletonTracingService.saveUpdates(tracingId, request.body)
      } yield {
        Ok
      }
    }
  }

  def downloadJson(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      for {
        tracingVersioned <- skeletonTracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
        updatedTracing <- skeletonTracingService.applyPendingUpdates(tracingVersioned, version)
        serialized <- skeletonTracingService.downloadJson(updatedTracing)
      } yield {
        Ok(serialized)
      }
    }
  }

  def downloadNml(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
      for {
        tracingVersioned <- skeletonTracingService.findVersioned(tracingId, version) ?~> Messages("tracing.notFound")
        updatedTracing <- skeletonTracingService.applyPendingUpdates(tracingVersioned, version)
        downloadStream <- skeletonTracingService.downloadNML(updatedTracing, dataSourceRepository)
      } yield {
        Ok.chunked(downloadStream).withHeaders(
          CONTENT_TYPE ->
            "application/octet-stream",
          CONTENT_DISPOSITION ->
            s"filename=${'"'}${updatedTracing.name}${'"'}.nml")
      }
    }
  }

  def duplicate(tracingId: String, version: Option[Long]) = Action.async {
    implicit request => {
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
