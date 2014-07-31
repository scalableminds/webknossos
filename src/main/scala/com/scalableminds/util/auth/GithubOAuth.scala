/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.auth

import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.{Logger}
import play.api.libs.ws.WS
import play.api.libs.json._
import net.liftweb.common.{Failure, Full}
import play.api.http.Status._
import play.api.http.HeaderNames._
import play.api.http.MimeTypes
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.JsSuccess
import net.liftweb.common.Full
import play.api.libs.functional.syntax._

trait GithubOauth extends FoxImplicits {

  def secret: String

  def clientId: String

  val GithubAccessTokenUri = "https://github.com/login/oauth/access_token"

  val GithubAuthorizeUri = "https://github.com/login/oauth/authorize"

  val accessTokenGithubReads: Reads[AccessToken] =
    ((__ \ 'access_token).read[String] and
      (__ \ 'scope).read[String] and
      (__ \ 'token_type).read[String])(AccessToken.apply _)

  def requestAccessToken(code: String, minScope: List[String]): Fox[AccessToken] = {
    WS
      .url(GithubAccessTokenUri)
      .withHeaders(ACCEPT -> MimeTypes.JSON)
      .withQueryString(
        "client_id" -> clientId,
        "client_secret" -> secret,
        "code" -> code
      )
      .post("")
      .map { response =>
      Logger.info("Response code from access token request: " + response.status + " Body: " + response.body)
      if (response.status == OK) {
        response.json.validate(accessTokenGithubReads) match {
          case JsSuccess(token, _) =>
            Logger.info("Got a response token.")
            Full(token)
          case f: JsError =>
            Logger.warn("Failed to parse response token. " + f)
            Failure("Requesting access token resulted in invalid json returned. " + f)
        }
      } else
        Failure(s"Requesting access token resulted in status ${response.status}. Body: ${response.body}")
    }
  }

  def authorizeUrl(state: String, scopes: List[String], redirectUri: String) =
    s"$GithubAuthorizeUri?client_id=$clientId&redirect_uri=$redirectUri&scope=${scopes.mkString(",")}&state=$state"

  def authorizeUrl(state: String, redirectUri: String) =
    s"$GithubAuthorizeUri?client_id=$clientId&redirect_uri=$redirectUri&state=$state"
}