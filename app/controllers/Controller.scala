package controllers

import play.api.mvc.{ Controller => PlayController }
import play.api.templates.Html
import play.api.libs.json.Json

class Controller extends PlayController {
  class AjaxResult(status: Status) {
    
    def apply(html: Html, message: String) = status(ajaxResult(html, message))
    
    def apply(message: String) = status(ajaxResult(Html.empty, message))
    
    def ajaxResult(html: Html, message: String) =
      Json.obj(
        "html" -> html.body,
        "message" -> message)
  }

  val AjaxOk = new AjaxResult(Ok)
}