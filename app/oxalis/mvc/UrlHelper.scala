package oxalis.mvc

import utils.WkConf

trait UrlHelper {
  lazy val httpUri = WkConf.Http.uri

  def toAbsoluteUrl(relativeUrl: String) = {
    httpUri + relativeUrl
  }
}
