/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.reactivemongo.{DBAccessContext, SecuredMongoDAO}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, AnnotationDAO}
import models.basics.{QuerySupportedDAO, SecuredBaseDAO}
import models.task.{Task, TaskDAO, info}
import models.user.UserDAO
import net.liftweb.common.Failure
import oxalis.security.Secured
import play.api.Logger
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}

class QueryController  @Inject() (val messagesApi: MessagesApi) extends Controller with Secured with FoxImplicits{

  def handleQuery(`type`: String, query: JsObject)(implicit ctx: DBAccessContext): Fox[JsValue] = `type` match {
    case "task" =>
      for{
        resultObjects <- TaskDAO.executeUserQuery(query, limit = 1000)
        jsResult <- Fox.combined(resultObjects.map(r => Task.transformToJson(r).toFox))
      } yield JsArray(jsResult)
    case _ =>
      Logger.error("Invalid query type")
      Fox.failure("Invalid query type")
  }

  def empty = Authenticated { implicit request =>
    Ok(JsArray())
  }

  def query(`type`: String) = Authenticated.async(parse.json) { implicit request =>
    for{
      _ <- request.user.hasAdminAccess ?~> "query.notAllowed"
      query <- request.body.asOpt[JsObject] ?~> "query.invalid.object"
      result <- handleQuery(`type`, query)
    } yield {
      Ok(result)
    }
  }

  import scala.reflect.runtime.universe._

  case class ParamDescription(name: String, typ: String, info: Option[String])

  object ParamDescription{
    implicit val format = Json.format[ParamDescription]

  }

  def infoAnnotationsOf[T: WeakTypeTag]: List[ParamDescription] = {
    symbolOf[T].asClass.primaryConstructor.typeSignature.paramLists.head.map(e =>
      ParamDescription(
        e.name.toString,
        e.typeSignature.toString,
        e.annotations
          .find(_.tree.tpe == typeOf[info])
          .map( ann => ann.tree.children.last.productElement(0).asInstanceOf[Constant].value.toString)))
  }

  def descriptions(element: String) = Authenticated{ implicit request =>
    val description = element match {
      case "task" =>
        Some(Json.toJson(infoAnnotationsOf[Task].map(a => a.name -> a).toMap))
    }
    description match {
      case Some(d) => Ok(d)
      case _ => BadRequest(Messages("invalid.element"))
    }
  }
}
