package brainflight.view

import brainflight.format.Formatter
import play.api.templates.Html

package object helpers
    extends BootstrapHelpers
    with Formatter {
  implicit def Html2ExtendedHtml(html: Html) = new ExtendedHtml(html)
}