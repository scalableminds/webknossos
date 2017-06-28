/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import com.google.inject.Inject
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.datastore.services.{TracingContentService, WebKnossosServer}
import com.scalableminds.braingames.datastore.tracings.skeleton.SkeletonTracingService
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global

class SkeletonTracingController @Inject()(
                                         webKnossosServer: WebKnossosServer,
                                         skeletonTracingService: SkeletonTracingService,
                                         dataSourceRepository: DataSourceRepository,
                                         val messagesApi: MessagesApi,
                                         tracingRepository: TracingContentService
                                       ) extends Controller {

  def create(dataSetName: String) = Action.async {
    implicit request => {
      for {
        dataSource <- dataSourceRepository.findUsableByName(dataSetName).toFox ?~> Messages("dataSource.notFound")
      } yield {
        val tracing = skeletonTracingService.create(dataSource)
        Ok(Json.toJson(tracing))
      }
    }
  }

}
