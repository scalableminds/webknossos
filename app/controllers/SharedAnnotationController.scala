package controllers

import models.annotation.{AnnotationType, SharedAnnotationDAO, SharedAnnotation, SharedAnnotationData}
import oxalis.annotation.AnnotationIdentifier
import play.Play
import play.api.i18n.Messages
import play.api.libs.json.Json
import scala.concurrent.{ExecutionContext, Future}
import ExecutionContext.Implicits.global

/**
 * Created by speedcom on 16.09.2014.
 */
object SharedAnnotationController extends SharedAnnotationController

trait SharedAnnotationController extends AnnotationController {

  def saveShare(typ: String, id: String) = Authenticated.async(parse.json) { implicit request =>
    request.body.validate[SharedAnnotationData].map {
      case _ =>
        val sharedAnnotationData = request.body.as[SharedAnnotationData]
        val sharedAnnotation = SharedAnnotation(typ, id, sharedAnnotationData.sharedLink, sharedAnnotationData.restrictions)

        SharedAnnotationDAO.insert(sharedAnnotation) // TODO check if saving into db was successful
        Future.successful(JsonOk(Messages("sharedAnnotation.success")))
    } recoverTotal {
      e => Future.successful(JsonBadRequest(Messages("sharedAnnotation.failed")))
    }
  }

  def getShare(sharedId: String) = UserAwareAction.async { implicit request =>
    val httpUri = Play.application().configuration().getString("http.uri")
    val sharedLink = s"$httpUri/sharedannotations/$sharedId/share"

    for {
      sharedAnnotation <- SharedAnnotationDAO.findOneBySharedLink(sharedLink)
      annotation <- findAnnotation(AnnotationIdentifier(AnnotationType.Share, sharedAnnotation.id))
    } yield {
      Ok(htmlForAnnotation(annotation))
    }
  }

  def deleteShare(typ: String, id: String) = Authenticated.async(parse.json) { implicit request =>
    for {
      sharedLink <- (request.body \ "sharedLink").asOpt[String].toFox
      _ <- SharedAnnotationDAO.removeObj(typ, id, sharedLink)
    } yield {
      JsonOk(Messages("sharedAnnotation.deleted"))
    }
  }

  def isShared(typ: String, id: String) = UserAwareAction.async { implicit request =>
    for {
      isShared <- SharedAnnotationDAO.isShared(typ, id)
    } yield {
      JsonOk(Json.obj("isShared" -> isShared))
    }
  }

  def getSharedLink(typ: String, id: String) = Authenticated.async { implicit request =>
    for {
      sharedLink <- SharedAnnotationDAO.getSharedLink(typ, id)
    } yield {
      JsonOk(Json.obj("sharedLink" -> sharedLink))
    }
  }

  def generateSharedLink(typ: String, id: String) = Authenticated.async { implicit request =>
    val httpUri = Play.application().configuration().getString("http.uri")
    val sharedId = java.util.UUID.randomUUID.toString
    val sharedLink = s"$httpUri/sharedannotations/$sharedId/share"

    Future.successful(JsonOk(
      Json.obj("sharedLink" -> sharedLink)))
  }

}