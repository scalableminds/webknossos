package controllers

import play.api.mvc.{ Controller => PlayController }
import play.api.templates.Html
import play.api.libs.json.Json
import play.api.mvc.SimpleResult
import play.api.libs.json.JsObject
import brainflight.security.AuthenticatedRequest
import brainflight.view.ProvidesSessionData

class Controller extends PlayController with ProvidesSessionData{
  
  def postParameter(parameter: String)(implicit request: AuthenticatedRequest[Map[String, Seq[String]]]) = 
    request.body.get(parameter).flatMap(_.headOption)
  
  class AjaxResult(status: Status) {
    
    def apply(html: Html, messages: Seq[(String, String)]) = 
      status(ajaxHTMLResult(html, messages))

    def success(html: Html, message: String) = status(ajaxHTMLResult(html, Seq(
      ajaxSuccess -> message)))

    def error(html: Html, message: String) = status(ajaxHTMLResult(html, Seq(
      ajaxError -> message)))

    def success(message: String): SimpleResult[JsObject] = success(Html.empty, message)
    def error(message: String): SimpleResult[JsObject] = error(Html.empty, message)

    def ajaxHTMLResult(html: Html, messages: Seq[(String, String)]) =
      Json.obj(
        "html" -> html.body,
        "messages" -> messages.map( m => Json.obj( m._1 -> m._2)))
  }

  val AjaxOk = new AjaxResult(Ok)
  val AjaxBadRequest = new AjaxResult(BadRequest)
  val ajaxSuccess = "success"
  val ajaxError = "error"
}