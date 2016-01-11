/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.mvc

trait UrlHelper {
  lazy val httpUri = play.api.Play.current.configuration.getString("http.uri").get

  def toAbsoluteUrl(relativeUrl: String) = {
    httpUri + relativeUrl
  }
}
