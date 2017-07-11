/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.FoxImplicits
import models.annotation.{Annotation, AnnotationDAO}
import models.task.{Task, TaskDAO}
import oxalis.security.{Secured, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future
import scala.util.Success

class SearchController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits {

  def find(q: String, typ: String) = Authenticated.async {
    implicit request =>
      typ match {
        case "id" => findById(q)
        case _    => Future.successful(JsonBadRequest("query.type.invalid"))
      }
  }

  def findById(id: String)(implicit request: UserAwareRequest[_]) = {
    BSONObjectID.parse(id) match {
      case Success(oid) =>

        val task = TaskDAO.findOneById(oid).toFox.flatMap(Task.transformToJson(_, request.userOpt))

        val foundAnnotation = () => AnnotationDAO.findOneById(oid).toFox.flatMap(_.toJson())

        task.orElse(foundAnnotation()).map(Ok(_)).getOrElse(NotFound(Json.obj()))
      case _            =>
        Future.successful(JsonBadRequest(Messages("bsonid.invalid")))
    }
  }

}
