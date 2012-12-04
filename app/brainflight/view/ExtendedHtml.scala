package brainflight.view

import play.api.templates.Html

class ExtendedHtml(html: Html) {
  def trim = Html(html.body.replace("\n","").trim)
}