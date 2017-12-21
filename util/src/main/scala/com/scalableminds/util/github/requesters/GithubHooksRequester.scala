/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import com.typesafe.scalalogging.LazyLogging
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json

trait GithubHooksRequester extends GithubRequester with LazyLogging {

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
        logger.debug("Creating hook. Response status: " + response.status)
        if(response.status != 201)
          logger.warn("Creating hook resulted in response: " + response.json)
        response.status
    }
}
