package com.scalableminds.util.tools

import play.api.libs.json.Json.WithDefaultValues
import play.api.libs.json.JsonConfiguration.Aux
import play.api.libs.json._

trait TristateOptionJsonHelper {

  implicit protected def optionFormat[T: Format]: Format[Option[T]] = new Format[Option[T]] {
    override def reads(json: JsValue): JsResult[Option[T]] = json.validateOpt[T]

    override def writes(o: Option[T]): JsValue = o match {
      case Some(t) => implicitly[Writes[T]].writes(t)
      case None    => JsNull
    }
  }

  private object InvertedDefaultHandler extends OptionHandlers {
    def readHandler[T](jsPath: JsPath)(implicit r: Reads[T]): Reads[Option[T]] = jsPath.readNullable

    override def readHandlerWithDefault[T](jsPath: JsPath, defaultValue: => Option[T])(implicit
        r: Reads[T]
    ): Reads[Option[T]] = Reads[Option[T]] { json =>
      jsPath.asSingleJson(json) match {
        case JsDefined(JsNull) => JsSuccess(defaultValue)
        case JsDefined(value)  => r.reads(value).repath(jsPath).map(Some(_))
        case _                 => JsSuccess(None)
      }
    }

    def writeHandler[T](jsPath: JsPath)(implicit writes: Writes[T]): OWrites[Option[T]] = jsPath.writeNullable
  }

  protected val tristateOptionParsing: Aux[WithDefaultValues] =
    JsonConfiguration[Json.WithDefaultValues](optionHandlers = InvertedDefaultHandler)

}
