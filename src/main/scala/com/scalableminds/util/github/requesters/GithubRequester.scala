/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import play.api.Logger
import play.api.libs.ws.WS
import play.api.libs.concurrent.Execution.Implicits._

trait GithubRequester {
  val GH = "https://api.github.com"

  def githubRequest(sub: String, prependHost: Boolean = true)(implicit token: String) = {
    import play.api.Play.current
    Logger.trace(s"Using Github Token: $token to query $sub")
    val url =
      if (prependHost)
        GH + sub
      else
        sub

    WS.url(url).withQueryString("access_token" -> token)
  }
}
