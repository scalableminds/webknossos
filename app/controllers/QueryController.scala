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
import models.user.{User, UserDAO}
import net.liftweb.common.Failure
import oxalis.security.Secured
import play.api.{Configuration, Logger}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsArray, JsObject, JsValue, Json}

class QueryController  @Inject() (val messagesApi: MessagesApi,  val configuration: Configuration) extends Controller with Secured with FoxImplicits{

  lazy val systemLimit = configuration.getInt("oxalis.query.maxResults").getOrElse(100)

  def handleQuery(`type`: String, query: JsObject, limit: Int, user: Option[User])(implicit ctx: DBAccessContext): Fox[JsValue] = `type` match {
    case "task" =>
      for{
        resultObjects <- TaskDAO.executeUserQuery(query, limit = limit)
        jsResult <- Fox.serialSequence(resultObjects)(t => Task.transformToJson(t, user))
      } yield JsArray(jsResult)
    case _ =>
      Logger.error("Invalid query type")
      Fox.failure("Invalid query type")
  }

  def empty = Authenticated { implicit request =>
    Ok(JsArray())
  }

  def query(`type`: String, userDefinedLimit: Int) = Authenticated.async(parse.json) { implicit request =>
    for{
      _ <- request.user.hasAdminAccess ?~> "query.notAllowed"
      query <- request.body.asOpt[JsObject] ?~> "query.invalid.object"
      limit = math.min(userDefinedLimit, systemLimit)
      result <- handleQuery(`type`, query, limit, request.userOpt)
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
