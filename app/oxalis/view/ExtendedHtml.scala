package oxalis.view

import play.twirl.api.Html

class ExtendedHtml(html: Html) {
  def trim = Html(html.body.replace("\n", "").trim)
}
