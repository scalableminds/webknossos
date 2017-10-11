/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.braingames.datastore.services.{AccessMode, AccessResourceType, UserAccessAnswer, UserAccessRequest}
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.scalableminds.util.tools.Fox
import models.annotation._
import models.user.{User, UserToken, UserTokenDAO}
import net.liftweb.common.Full
import oxalis.security.Secured
import play.api.i18n.MessagesApi
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global

class UserTokenController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with Secured
    with WKDataStoreActionHelper
    with AnnotationInformationProvider {

  val webKnossosToken = play.api.Play.current.configuration.getString("application.authentication.dataStoreToken").getOrElse("somethingSecure")

  def generateUserToken = UserAwareAction.async { implicit request =>
    val context = authedRequestToDBAccess(request)

    val tokenFox: Fox[String] = request.userOpt match {
      case Some(user) =>
        val token = UserToken(user._id)
        UserTokenDAO.insert(token).map(_ => token.token)
      case None => Fox.successful("")
    }
    for {
      token <- tokenFox
    } yield {
      Ok(Json.obj("token" -> token))
    }
  }

  def validateUserAccess(name: String, token: String) = DataStoreAction(name).async(validateJson[UserAccessRequest]) { implicit request =>
    implicit val ctx = GlobalAccessContext //TODO: RocksDB is this really necessary?
    val accessRequest = request.body
    if (token == webKnossosToken) {
      Fox.successful(Ok(Json.toJson(UserAccessAnswer(true))))
    } else {
      for {
        userToken <- UserTokenDAO.findByToken(token)
        user <- userToken.user
        answer <- accessRequest.resourceType match {
          case AccessResourceType.datasource =>
            handleDataSourceAccess(accessRequest.resourceId, accessRequest.mode, user)
          case AccessResourceType.tracing =>
            handleTracingAccess(accessRequest.resourceId, accessRequest.mode, user)
          case _ =>
            Fox.successful(UserAccessAnswer(false, Some("Invalid access token.")))
        }
      } yield {
        Ok(Json.toJson(answer))
      }
    }
  }

  private def handleDataSourceAccess(dataSourceName: String, mode: AccessMode.Value, user: User) = {
    Fox.successful(UserAccessAnswer(true))
  }

  private def handleTracingAccess(tracingId: String, mode: AccessMode.Value, user: User) = {
    implicit val ctx = GlobalAccessContext //TODO: RocksDB is this really necessary?

    def findAnnotationForTracing(tracingId: String): Fox[Annotation] = {
      val annotationFox = AnnotationDAO.findByTracingId(tracingId)
      for {
        annotationBox <- annotationFox.futureBox
      } yield {
        annotationBox match {
          case Full(_) => annotationBox
          case _ => AnnotationStore.findCachedByTracingId(tracingId)
        }
      }
    }

    def checkRestrictions(restrictions: AnnotationRestrictions) = {
      mode match {
        case AccessMode.read => restrictions.allowAccess(user)
        case AccessMode.write => restrictions.allowUpdate(user)
      }
    }

    for {
      annotation <- findAnnotationForTracing(tracingId)
      restrictions <- restrictionsFor(AnnotationIdentifier(annotation.typ, annotation.id))
      allowed = checkRestrictions(restrictions)
    } yield {
      if (allowed) UserAccessAnswer(true) else UserAccessAnswer(false, Some(s"No ${mode.toString} access to tracing"))
    }
  }
}
