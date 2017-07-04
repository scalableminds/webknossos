/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import com.scalableminds.braingames.datastore.tracings.skeleton.{SkeletonTracingService, SkeletonUpdateAction}
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

  def create(dataSetName: String) = Action {
    implicit request => {
      val tracing = skeletonTracingService.create()
      Ok(Json.toJson(tracing))
    }
  }

  def createFromNML(name: String) = Action(parse.tolerantText) {
    implicit request => {
      for {
        tracing <- skeletonTracingService.createFromNML(name, request.body)
      } yield {
        Ok(Json.toJson(tracing))
      }
    }
  }

  def update(tracingId: String) = Action.async(validateJson[List[SkeletonUpdateAction]]) {
    implicit request => {
      for {
        tracing <- skeletonTracingService.find(tracingId) ?~> Messages("tracing.notFound")
        _ <- skeletonTracingService.update(tracing, request.body)
      } yield {
        Ok
      }
    }
  }

  def downloadJson(tracingId: String, version: Long) = Action.async {
    implicit request => {
      for {
        tracing <- skeletonTracingService.find(tracingId, Some(version)) ?~> Messages("tracing.notFound")
        serialized <- skeletonTracingService.downloadJson(tracing)
      } yield {
        Ok(serialized)
      }
    }
  }

  def downloadNML(tracingId: String, version: Long) = Action.async {
    implicit request => {
      for {
        tracing <- skeletonTracingService.find(tracingId, Some(version)) ?~> Messages("tracing.notFound")
        downloadStream <- skeletonTracingService.downloadNML(tracing)
      } yield {
        Ok.chunked(downloadStream).withHeaders(
          CONTENT_TYPE ->
            "application/octet-stream",
          CONTENT_DISPOSITION ->
            s"filename=${'"'}${tracing.name}${'"'}.nml")
      }
    }
  }

  def duplicate(tracingId: String, version: Long) = Action {
    implicit request => {
      Ok
    }
  }

}
