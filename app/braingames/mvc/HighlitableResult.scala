package braingames.mvc

import play.api.mvc.PlainResult
import play.api.http.HeaderNames._

trait withHighlitableResult {
  implicit class HighlitableResult(r: PlainResult) {
    def highlighting(elementId: String) = {
      val location = r.header.headers.get(LOCATION) getOrElse ""
      r.withHeaders(LOCATION -> s"$location#$elementId")
    }
  }
}