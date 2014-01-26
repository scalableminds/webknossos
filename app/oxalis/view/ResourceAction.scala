package oxalis.view

import play.api.mvc.Call

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 18.01.14
 * Time: 14:05
 */
case class ResourceAction(
                           name: String,
                           call: Call,
                           condition: Boolean = true,
                           icon: Option[String] = None,
                           dataAjax: Option[String] = None,
                           clazz: String = ""
                         )

case class ResourceActionCollection(actions: List[ResourceAction]) {
  val active = actions.filter(_.condition)

  def allow(actionName: String) =
    active.find(_.name == actionName)
}

object ResourceActionCollection{
  def apply(actions: ResourceAction *): ResourceActionCollection =
    ResourceActionCollection(actions.toList)
}

trait DefaultResourceActionNames {
  val Finish = "finish"
  val Download = "download"
}

object ResourceAction extends DefaultResourceActionNames
