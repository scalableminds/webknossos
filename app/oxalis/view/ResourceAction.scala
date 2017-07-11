package oxalis.view

import play.api.libs.functional.syntax._
import play.api.libs.json._
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
			                     isAjax: Boolean = false,
                           clazz: String = ""
                         )

trait DefaultResourceActionNames {
  val Finish = "finish"
  val Download = "download"
}

object ResourceAction extends DefaultResourceActionNames{
  private implicit val callWrites: Writes[Call] =
    ((__ \ 'url).write[String] and
      (__ \ 'method).write[String])(c => (c.url, c.method))

  implicit val resourceActionWrites = Json.writes[ResourceAction]
}


case class ResourceActionCollection(actions: List[ResourceAction]) {
  val active = actions.filter(_.condition)

  def allow(actionName: String) =
    active.find(_.name == actionName)
}

object ResourceActionCollection{
  def apply(actions: ResourceAction *): ResourceActionCollection =
    ResourceActionCollection(actions.toList)

  implicit val resourceActionCollectionWrites =
    Writes[ResourceActionCollection]( rs => JsArray(rs.active.map(ResourceAction.resourceActionWrites.writes)))
}

