package com.scalableminds.util.tools

import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json.JsonConfiguration.Aux
import play.api.libs.json._

object TristateOptionJsonHelper {

  implicit private def optionFormat[T](implicit tf: Format[T]): Format[Option[T]] = Format(
    tf.reads(_).map(r => Some(r)),
    Writes(v => v.map(tf.writes).getOrElse(JsNull))
  )

  private object InvertedDefaultHandler extends OptionHandlers {
    def readHandler[T](jsPath: JsPath)(implicit r: Reads[T]): Reads[Option[T]] = jsPath.readNullable

    override def readHandlerWithDefault[T](jsPath: JsPath, defaultValue: => Option[T])(
        implicit r: Reads[T]): Reads[Option[T]] = Reads[Option[T]] { json =>
      jsPath.asSingleJson(json) match {
        case JsDefined(JsNull) => JsSuccess(defaultValue)
        case JsDefined(value)  => r.reads(value).repath(jsPath).map(Some(_))
        case JsUndefined()     => JsSuccess(None)
      }
    }

    def writeHandler[T](jsPath: JsPath)(implicit writes: Writes[T]): OWrites[Option[T]] = jsPath.writeNullable
  }

  val tristateOptionParsing: Aux[WithDefaultValues] =
    JsonConfiguration[Json.WithDefaultValues](optionHandlers = InvertedDefaultHandler)

}
