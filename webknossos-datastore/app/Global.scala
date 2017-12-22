/*
* Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/

import play.api._
import play.api.mvc.Results._
import play.api.mvc.{Action, Handler, RequestHeader}

object Global extends GlobalSettings {

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.method == "OPTIONS") {
      Some(Action {
        Ok(":D").withHeaders(
          "Access-Control-Allow-Origin" -> "*",
          "Access-Control-Max-Age" -> "600",
          "Access-Control-Allow-Methods" -> "POST, GET, DELETE, PUT, HEAD, PATCH, OPTIONS",
          "Access-Control-Allow-Headers" -> request.headers.get("Access-Control-Request-Headers").getOrElse(""))
      })
    } else {
      super.onRouteRequest(request)
    }
  }
}
