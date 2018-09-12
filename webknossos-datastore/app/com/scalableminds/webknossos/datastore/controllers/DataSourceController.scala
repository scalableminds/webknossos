package com.scalableminds.webknossos.datastore.controllers

import java.io.File

import com.google.inject.Inject
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.{Box, Empty, Failure, Full}
import com.scalableminds.webknossos.datastore.models.datasource.{DataSource, DataSourceId}
import com.scalableminds.webknossos.datastore.services._
import play.api.data.Form
import play.api.data.Forms.{nonEmptyText, tuple}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import com.scalableminds.webknossos.datastore.models.datasource.inbox.{InboxDataSource, InboxDataSourceLike}


import scala.concurrent.ExecutionContext.Implicits.global

class DataSourceController @Inject()(
                                      dataSourceRepository: DataSourceRepository,
                                      dataSourceService: DataSourceService,
                                      webKnossosServer: WebKnossosServer,
                                      val accessTokenService: AccessTokenService,
                                      val messagesApi: MessagesApi
                                    ) extends TokenSecuredController with FoxImplicits {

  def list() = TokenSecuredAction(UserAccessRequest.listDataSources) {
    implicit request => {
      AllowRemoteOrigin {
        val ds = dataSourceRepository.findAll
        Ok(Json.toJson(ds))
      }
    }
  }

  def read(dataSetName: String, returnFormatLike: Boolean) = TokenSecuredAction(UserAccessRequest.readDataSources(dataSetName)) {
    implicit request => {
      AllowRemoteOrigin {
        val dsOption: Option[InboxDataSource] = dataSourceRepository.findByName(dataSetName)
        dsOption match {
          case Some(ds) => {
            val dslike: InboxDataSourceLike = ds
            if(returnFormatLike) Ok(Json.toJson(dslike))
            else Ok(Json.toJson(ds))
          }
          case _ => Ok
        }
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

  def triggerInboxCheckBlocking() = TokenSecuredAction(UserAccessRequest.administrateDataSources).async {
    implicit request =>
      AllowRemoteOrigin {
        for {
          _ <- dataSourceService.checkInbox()
        } yield Ok
      }
  }

  def upload = TokenSecuredAction(UserAccessRequest.administrateDataSources).async(parse.multipartFormData) {
    implicit request =>

    val uploadForm = Form(
      tuple(
        "name" -> nonEmptyText.verifying("dataSet.name.invalid", n => n.matches("[A-Za-z0-9_\\-]*")),
        "organization" -> nonEmptyText
      )).fill(("", ""))

    AllowRemoteOrigin {
      uploadForm.bindFromRequest(request.body.dataParts).fold(
        hasErrors =
          formWithErrors => Fox.successful(JsonBadRequest(formWithErrors.errors.head.message)),
        success = {
          case (name, organization) =>
            val id = DataSourceId(name, organization)
            for {
              _ <- webKnossosServer.validateDataSourceUpload(id) ?~> "dataSet.name.alreadyTaken"
              zipFile <- request.body.file("zipFile[]") ?~> "zip.file.notFound"
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
          previousDataSource <- dataSourceRepository.findByName(dataSetName) ?~ Messages("dataSource.notFound") ~> 404
          (dataSource, messages) <- dataSourceService.exploreDataSource(previousDataSource.id, previousDataSource.toUsable)
        } yield {
          Ok(Json.obj(
            "dataSource" -> dataSource,
            "messages" -> messages.map(m => Json.obj(m._1 -> m._2))
          ))
        }
      }
  }

  def update(dataSetName: String) = TokenSecuredAction(UserAccessRequest.writeDataSource(dataSetName)).async(validateJson[DataSource]) {
    implicit request =>
      AllowRemoteOrigin {
        for {
          _ <- Fox.successful(())
          dataSource <- dataSourceRepository.findByName(dataSetName).toFox ?~> Messages ("dataSource.notFound") ~> 404
          _ <- dataSourceService.updateDataSource(request.body.copy(id = dataSource.id))
        } yield {
          Ok
        }
      }
  }

  def createOrganizationDirectory(organizationName: String) = TokenSecuredAction(UserAccessRequest.administrateDataSources) { implicit request =>
    AllowRemoteOrigin{
      val newOrganizationFolder = new File(dataSourceService.dataBaseDir + "/" + organizationName)
        newOrganizationFolder.mkdirs()
      if(newOrganizationFolder.isDirectory)
        Ok
      else
        BadRequest
    }
  }

}
