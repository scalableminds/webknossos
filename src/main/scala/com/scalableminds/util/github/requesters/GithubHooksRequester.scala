/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import play.api.libs.json.Json
import play.api.Logger
import play.api.libs.concurrent.Execution.Implicits._

trait GithubHooksRequester extends GithubRequester {

  def hooksUrl(repo: String): String

  def hook(url: String) =
    Json.obj(
      "name" -> "web",
      "active" -> true,
      "events" -> List("issues"),
      "config" -> Json.obj(
        "url" -> url,
        "content_type" -> "json"
      )
    )

  def createWebHook(token: String, repo: String, url: String) =
    githubRequest(hooksUrl(repo))(token).post(hook(url)).map {
      response =>
        Logger.debug("Creating hook. Response status: " + response.status)
        if(response.status != 201)
          Logger.warn("Creating hook resulted in response: " + response.json)
        response.status
    }
}
