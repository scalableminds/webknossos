/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.braingames.datastore.controllers

import java.io.File

import com.google.inject.Inject
import com.scalableminds.braingames.binary.api.DataSourceService
import com.scalableminds.braingames.binary.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.braingames.binary.services.DataSourceRepository
import com.scalableminds.braingames.datastore.services.WebKnossosServer
import play.api.data.Form
import play.api.data.Forms.{nonEmptyText, tuple}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.{JsValue, Json}
import play.api.mvc.Action

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future

class DataSourceController @Inject()(
                                      dataSourceService: DataSourceService,
                                      dataSourceRepository: DataSourceRepository,
                                      webKnossosServer: WebKnossosServer,
                                      val messagesApi: MessagesApi
                                    ) extends Controller {

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
      // TODO use team from request / name from filename?
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
            // TODO
            // oxalisServer <- DataStorePlugin.current.map(_.oxalisServer).toFox ?~> Messages("oxalis.server.unreachable")
            // _ <- oxalisServer.validateDSUpload(token, name, team) ?~> Messages("dataSet.name.alreadyTaken")
            zipFile <- request.body.file("zipFile") ?~> Messages("zip.file.notFound")
            _ <- dataSourceService.handleUpload(id, new File(zipFile.ref.file.getAbsolutePath))
          } yield {
            Ok
          }
      })
  }

  def explore(dataSetName: String) = Action {
    implicit request =>
      // TODO check if allowed and get team / modify action to get dataSourceId??
      val id = DataSourceId(dataSetName, "Connectomics department")
      for {
        dataSource <- dataSourceRepository.findById(id) ?~ Messages("dataSource.notFound") ~> 404
        (dataSource, messages) <- dataSourceService.exploreDataSource(id, dataSource.toUsable)
      } yield {
        Ok(Json.obj(
          "dataSource" -> dataSource,
          "messages" -> messages.map(m => Json.obj(m._1 -> m._2))
        ))
      }
  }

  def update(dataSetName: String) = Action(validateJson[DataSource]) {
    implicit request =>
      val id = DataSourceId(dataSetName, "Connectomics department")
      val dataSource = request.body.copy(id = id)
      dataSourceService.updateDataSource(dataSource).map(_ => Ok)
  }
}
