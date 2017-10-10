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
import com.scalableminds.braingames.datastore.services.UserAccessRequest

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

  def validateUserAccess(name: String, token: String) = DataStoreAction(name)(validateJson[UserAccessRequest]) { implicit request =>
    val accessRequest = request.body
    println(s"${token} tries to ${accessRequest.mode} ${accessRequest.resourceType}/${accessRequest.resourceId}")
    // TODO RocksDB return Ok, if token == webknossosToken
    Ok
  }
}
