package views

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 17.08.13
 * Time: 14:10
 */
import views.html.helper.FieldConstructor

object BootstrapHelpers extends BootstrapHelpers

trait BootstrapHelpers {

  implicit val bootsrapFields = FieldConstructor(views.html.BootstrapFieldConstructor.f)

}