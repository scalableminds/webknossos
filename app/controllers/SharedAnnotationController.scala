package controllers

import models.annotation._
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
        val sharedAnnotation = SharedAnnotation(typ, id, sharedAnnotationData.sharedId, sharedAnnotationData.restrictions)

        SharedAnnotationDAO.insert(sharedAnnotation) // TODO check if saving into db was successful

        Future.successful(JsonOk(Messages("sharedAnnotation.success")))
    } recoverTotal {
      e => Future.successful(JsonBadRequest(Messages("sharedAnnotation.failed")))
    }
  }

  def getShare(sharedId: String) = UserAwareAction.async { implicit request =>
    for {
      sharedAnnotation <- SharedAnnotationDAO.findOneBySharedId(sharedId)
      annotation <- findAnnotation(AnnotationIdentifier(AnnotationType.Share, sharedAnnotation.id))
    } yield {
      Ok(htmlForAnnotation(annotation, isShared = true))
    }
  }

  def deleteShare(typ: String, id: String) = Authenticated.async(parse.json) { implicit request =>
    for {
      sharedId <- (request.body \ "sharedId").asOpt[String].toFox
      _ <- SharedAnnotationDAO.removeObj(typ, id, sharedId)
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
      sharedId <- SharedAnnotationDAO.getSharedId(typ, id)
    } yield {
      val sharedLink = SharedLinkHandler.createLink(sharedId)
      val sharedData = SharedSendData(sharedId, sharedLink)
      JsonOk(Json.obj("sharedData" -> sharedData))
    }
  }

  def generateSharedLink(typ: String, id: String) = Authenticated.async { implicit request =>
    val sharedData = SharedLinkHandler.generateSharedData()
    Future.successful(JsonOk(Json.obj("sharedData" -> sharedData)))
  }

}