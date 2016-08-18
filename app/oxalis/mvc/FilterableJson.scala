package oxalis.mvc

import play.api.libs.json.Json.JsValueWrapper
import scala.concurrent.Future
import play.api.libs.json.Json
import play.api.libs.concurrent.Execution.Implicits._

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
    val attrs = attributes.filter(attr => !exclude.contains(attr.key))

    Future.sequence(attrs.map(_.value())).map {
      values =>
	Json.obj(attrs.map(_.key).zip(values): _*)
    }
  }
}
