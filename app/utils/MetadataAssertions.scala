package utils

import com.scalableminds.util.tools.Fox
import play.api.i18n.{Messages, MessagesProvider}
import play.api.libs.json.{JsArray, JsObject}

import scala.concurrent.ExecutionContext

trait MetadataAssertions {
  def assertNoDuplicateMetadataKeys(
      metadata: JsArray
  )(implicit ec: ExecutionContext, provider: MessagesProvider): Fox[Unit] = {
    val keys = metadata.value.flatMap(_.as[JsObject] \\ "key").map(_.as[String]).toList
    if (keys.size == keys.distinct.size) Fox.successful(()) else Fox.failure(Messages("dataset.metadata.duplicateKeys"))
  }
}
