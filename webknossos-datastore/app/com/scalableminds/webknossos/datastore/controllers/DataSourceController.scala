/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.webknossos.datastore.controllers

import java.io.File

import com.google.inject.Inject
import com.scalableminds.webknossos.datastore.binary.api.DataSourceService
import com.scalableminds.webknossos.datastore.binary.helpers.DataSourceRepository
import com.scalableminds.webknossos.datastore.binary.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.services.{AccessTokenService, UserAccessRequest, WebKnossosServer}
import play.api.data.Form
import play.api.data.Forms.{nonEmptyText, tuple}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import play.api.mvc._

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class DataSourceController @Inject()(
                                      dataSourceRepository: DataSourceRepository,
                                      dataSourceService: DataSourceService,
                                      webKnossosServer: WebKnossosServer,
                                      val accessTokenService: AccessTokenService,
                                      val messagesApi: MessagesApi
                                    ) extends TokenSecuredController {

  def list() = TokenSecuredAction(UserAccessRequest.listDataSources) {
    implicit request => {
      AllowRemoteOrigin {
        val ds = dataSourceRepository.findAll
        Ok(Json.toJson(ds))
      }
    }
  }

  def triggerInboxCheck() = TokenSecuredAction(UserAccessRequest.administrateDataSources) {
    implicit request =>
      AllowRemoteOrigin {
        dataSourceService.checkInbox()
        Ok
      }
  }

  def upload = TokenSecuredAction(UserAccessRequest.administrateDataSources).async(parse.multipartFormData) {
    implicit request =>

    val uploadForm = Form(
      tuple(
        "name" -> nonEmptyText.verifying("dataSet.name.invalid", n => n.matches("[A-Za-z0-9_\\-]*")),
        "team" -> nonEmptyText
      )).fill(("", ""))

    AllowRemoteOrigin {
      uploadForm.bindFromRequest(request.body.dataParts).fold(
        hasErrors =
          formWithErrors => Future.successful(JsonBadRequest(formWithErrors.errors.head.message)),
        success = {
          case (name, team) =>
            val id = DataSourceId(name, team)
            for {
              _ <- webKnossosServer.validateDataSourceUpload(id) ?~> Messages("dataSet.name.alreadyTaken")
              zipFile <- request.body.file("zipFile[]") ?~> Messages("zip.file.notFound")
              _ <- dataSourceService.handleUpload(id, new File(zipFile.ref.file.getAbsolutePath))
            } yield {
              Ok
            }
        })
    }
  }

  def explore(dataSetName: String) = TokenSecuredAction(UserAccessRequest.writeDataSource(dataSetName)) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          dataSource <- dataSourceRepository.findByName(dataSetName) ?~ Messages("dataSource.notFound") ~> 404
          (dataSource, messages) <- dataSourceService.exploreDataSource(dataSource.id, dataSource.toUsable)
        } yield {
          Ok(Json.obj(
            "dataSource" -> dataSource,
            "messages" -> messages.map(m => Json.obj(m._1 -> m._2))
          ))
        }
      }
  }

  def update(dataSetName: String) = TokenSecuredAction(UserAccessRequest.writeDataSource(dataSetName))(validateJson[DataSource]) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          dataSource <- dataSourceRepository.findByName (dataSetName) ?~ Messages ("dataSource.notFound") ~> 404
          _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id))
        } yield {
          Ok
        }
      }
  }
}
