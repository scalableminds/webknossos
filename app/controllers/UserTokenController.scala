/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import javax.inject.Inject

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.UserTokenService
import oxalis.security.Secured
import play.api.i18n.MessagesApi
  import play.api.libs.json.Json
  import scala.concurrent.ExecutionContext.Implicits.global

class UserTokenController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with WKDataStoreActionHelper with FoxImplicits {

  def generateUserToken = UserAwareAction.async { implicit request =>
    val context = authedRequestToDBAccess(request)

    val tokenFox: Fox[String] = request.userOpt match {
      case Some(user) => UserTokenService.generate(user).map(_.token)
      case None => Fox.successful("")
    }
    for {
      token <- tokenFox
    } yield {
      Ok(Json.obj("token" -> token))
    }
  }

  def validateUserToken(name: String) = DataStoreAction(name)(parse.json) { implicit request =>
    val resourceType = (request.body \ "resourceType").asOpt[String]
    val token = (request.body \ "token").asOpt[String]
    val resourceIdentifier = (request.body \ "resourceIdentifier").asOpt[String]
    val action = (request.body \ "action").asOpt[String]

    Ok
  }
}
