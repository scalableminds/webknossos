package com.scalableminds.util.mvc

import play.api.http.HeaderNames._
import play.api.mvc.Result

trait WithHighlightableResult {

  implicit class HighlightableResult(r: Result) {
    def highlighting(elementId: String) = {
      val location = r.header.headers.getOrElse(LOCATION, "")
      r.withHeaders(LOCATION -> s"$location#$elementId")
    }
  }

}
