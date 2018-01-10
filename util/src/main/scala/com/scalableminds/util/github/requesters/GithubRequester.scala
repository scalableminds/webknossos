/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.github.requesters

import com.typesafe.scalalogging.LazyLogging
import play.api.libs.ws.WS

trait GithubRequester extends LazyLogging{
  val GH = "https://api.github.com"

  def githubRequest(sub: String, prependHost: Boolean = true)(implicit token: String) = {
    import play.api.Play.current
    logger.trace(s"Using Github Token: $token to query $sub")
    val url =
      if (prependHost)
        GH + sub
      else
        sub

    WS.url(url).withQueryString("access_token" -> token)
  }
}
