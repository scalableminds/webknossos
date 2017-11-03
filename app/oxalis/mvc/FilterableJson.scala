package oxalis.mvc

import com.scalableminds.util.tools.Fox
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import play.api.libs.json.Json.JsValueWrapper

import scala.concurrent.Future

object FilterableJson

trait FilterableJson {

  class JsonAttribute(val key: String, val value: () => Future[JsValueWrapper])

  implicit class JsonKey(key: String) {

    def +>[T](v: => Future[T])(implicit f: T => JsValueWrapper): JsonAttribute =
      new JsonAttribute(key, () => v.map(f))

    def +>[T](v: T)(implicit f: T => JsValueWrapper): JsonAttribute =
      +>(Future.successful(v))
  }

  def JsonObjectWithFilter(exclude: List[String])(attributes: JsonAttribute*) = {
    val attrs = attributes.filter(attr => !exclude.contains(attr.key)).toList

    Fox.serialSequence(attrs)(_.value()).map {
      values =>
        Json.obj(attrs.map(_.key).zip(values): _*)
    }
  }
}
