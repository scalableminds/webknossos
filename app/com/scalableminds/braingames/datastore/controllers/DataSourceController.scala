/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import java.io.File

import com.google.inject.Inject
import com.scalableminds.braingames.binary.api.DataSourceService
import com.scalableminds.braingames.binary.helpers.DataSourceRepository
import com.scalableminds.braingames.binary.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.braingames.datastore.services.{AccessTokenService, WebKnossosServer}
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

  def list() = Action {
    implicit request => {
      val ds = dataSourceRepository.findAll
      Ok(Json.toJson(ds))
    }
  }

  def triggerInboxCheck() = Action {
    implicit request =>
      dataSourceService.checkInbox()
      Ok
  }

  def upload(token: String) = Action.async(parse.multipartFormData) {
    implicit request =>

    val uploadForm = Form(
      tuple(
        "name" -> nonEmptyText.verifying("dataSet.name.invalid", n => n.matches("[A-Za-z0-9_\\-]*")),
        "team" -> nonEmptyText
      )).fill(("", ""))

    uploadForm.bindFromRequest(request.body.dataParts).fold(
      hasErrors =
        formWithErrors => Future.successful(JsonBadRequest(formWithErrors.errors.head.message)),
      success = {
        case (name, team) =>
          val id = DataSourceId(name, team)
          for {
            _ <- webKnossosServer.validateDataSourceUpload(token, id) ?~> Messages("dataSet.name.alreadyTaken")
            zipFile <- request.body.file("zipFile") ?~> Messages("zip.file.notFound")
            _ <- dataSourceService.handleUpload(id, new File(zipFile.ref.file.getAbsolutePath))
          } yield {
            Ok
          }
      })
  }

  def explore(dataSetName: String) = Action {
    implicit request =>
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

  def update(dataSetName: String) = Action(validateJson[DataSource]) {
    implicit request =>
      for {
        dataSource <- dataSourceRepository.findByName(dataSetName) ?~ Messages("dataSource.notFound") ~> 404
        _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id))
      } yield {
        Ok
      }
  }
}
