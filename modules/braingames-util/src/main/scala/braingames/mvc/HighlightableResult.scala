package braingames.mvc

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 13.08.13
 * Time: 14:46
 */
import play.api.mvc.PlainResult
import play.api.http.HeaderNames._

trait withHighlightableResult {
  implicit class HighlightableResult(r: PlainResult) {
    def highlighting(elementId: String) = {
      val location = r.header.headers.get(LOCATION) getOrElse ""
      r.withHeaders(LOCATION -> s"$location#$elementId")
    }
  }
}