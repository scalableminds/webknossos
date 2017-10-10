/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.{User, UserToken, UserTokenDAO}
import oxalis.security.Secured
import play.api.i18n.MessagesApi
import play.api.libs.json.Json

import scala.concurrent.ExecutionContext.Implicits.global
import com.scalableminds.braingames.datastore.services.{AccessMode, AccessRessourceType, UserAccessRequest}

import scala.concurrent.Future

class UserTokenController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with WKDataStoreActionHelper with FoxImplicits {

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
    val accessRequest = request.body
    if (token == webKnossosToken) {
      Fox.successful(Ok)
    } else {
      for {
        userToken <- UserTokenDAO.findByToken(token)
        user <- userToken.user
        result <- accessRequest match {
          case AccessRessourceType.datasource =>
            handleDataSourceAccess(accessRequest.resourceId, accessRequest.mode, user)
          case AccessRessourceType.tracing =>
            handleTracingAccess(accessRequest.resourceId, accessRequest.mode, user)
          case _ =>
            Fox.successful(Forbidden("Invalid access token."))
        }
      } yield {
        result
      }
    }
  }

  private def handleDataSourceAccess(dataSourceName: String, mode: AccessMode.Value, user: User) = {
    Fox.successful(Ok)
  }

  private def handleTracingAccess(tracingId: String, mode: AccessMode.Value, user: User) = {
    Fox.successful(Forbidden("sorry :P"))
  }
}
