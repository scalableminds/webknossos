package models.annotation

import play.api.libs.json.Json

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 15:07
 */

case class ContentReference(contentType: String, _id: String)
object ContentReference {implicit val jsonFormat = Json.format[ContentReference]}

