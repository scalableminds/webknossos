package brainflight.view

import brainflight.format.Formatter
import play.api.templates.Html

package object helpers
    extends BootstrapHelpers
    with Formatter {
  implicit def Html2ExtendedHtml(html: Html) = new ExtendedHtml(html)

  def ajaxAttributes(route: play.api.mvc.Call, ajaxParameters: String = "") = {
  	val preparedAjaxParameters = if (ajaxParameters != "") "," + ajaxParameters else ""
  	Html(" href=\"" + route.toString + "\" data-ajax=\"method=" + route.method + preparedAjaxParameters + "\" ")
  }
}