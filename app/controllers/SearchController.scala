/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import play.api.libs.concurrent.Execution.Implicits._
import scala.concurrent.Future
import scala.util.Success

import com.scalableminds.util.tools.FoxImplicits
import models.annotation.{Annotation, AnnotationDAO}
import models.task.{Task, TaskDAO}
import oxalis.security.silhouetteOxalis.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID

class SearchController @Inject()(val messagesApi: MessagesApi) extends Controller with FoxImplicits {

  def find(q: String, typ: String) = SecuredAction.async {
    implicit request =>
      typ match {
        case "id" => findById(q)(securedRequestToUserAwareRequest)
        case _    => Future.successful(JsonBadRequest("query.type.invalid"))
      }
  }

  def findById(id: String)(implicit request: UserAwareRequest[_]) = {
    BSONObjectID.parse(id) match {
      case Success(oid) =>

        val task = TaskDAO.findOneById(oid).flatMap(t => future2Fox(Task.transformToJson(t, request.identity)))

        val foundAnnotation = () => AnnotationDAO.findOneById(oid).flatMap(a => future2Fox(Annotation.transformToJson(a)))

        val noResult = NotFound(Json.obj())

        task.orElse(foundAnnotation()).map(js => Ok(js)).getOrElse(noResult)
      case _            =>
        Future.successful(JsonBadRequest(Messages("bsonid.invalid")))
    }
  }

}
