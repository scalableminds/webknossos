package models.binary

import play.api.data.validation.ValidationError
import play.api.libs.json._

sealed trait DataStoreType {
  val name: String
}

case object WebKnossosStore extends DataStoreType {
  val name = "webknossos-store"
}

object DataStoreType {

  def stringToType(s: String): DataStoreType = s match {
    case WebKnossosStore.name => WebKnossosStore
    case _                    => throw new UnsupportedOperationException()
  }

  implicit object DataStoreTypeJsonFormatter extends Format[DataStoreType] {
    override def reads(json: JsValue): JsResult[DataStoreType] = json match {
      case JsString(value) =>
        try {
          JsSuccess(stringToType(value))
        } catch {
          case _: UnsupportedOperationException =>
            JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.string.invalidContent"))))
        }
      case _               =>
        JsError(Seq(JsPath() -> Seq(ValidationError("validate.error.expected.string"))))
    }

    override def writes(o: DataStoreType): JsValue = JsString(o.name)
  }


}
