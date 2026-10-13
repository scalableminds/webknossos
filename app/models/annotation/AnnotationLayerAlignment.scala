package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import play.api.libs.json.{Json, OFormat}
import slick.jdbc.PostgresProfile.api.*
import slick.sql.SqlAction
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class AnnotationLayerAlignment(fixedLayerName: String, movingLayerName: String) {
  // E.g. "l4_sample_with_… Alignment: color_2 → color_1"
  def defaultAnnotationName(datasetName: String): String = {
    val maxDatasetNameLength = 15
    val shortDatasetName =
      if (datasetName.length > maxDatasetNameLength) s"${datasetName.take(maxDatasetNameLength)}…"
      else datasetName
    s"$shortDatasetName Alignment: $movingLayerName → $fixedLayerName"
  }
}

object AnnotationLayerAlignment {
  implicit val jsonFormat: OFormat[AnnotationLayerAlignment] = Json.format[AnnotationLayerAlignment]

  def fromColumns(
      fixedLayerNameOpt: Option[String],
      movingLayerNameOpt: Option[String]
  ): Option[AnnotationLayerAlignment] =
    (fixedLayerNameOpt, movingLayerNameOpt) match {
      case (Some(fixed), Some(moving)) => Some(AnnotationLayerAlignment(fixed, moving))
      case _                           => None
    }
}

class AnnotationLayerAlignmentDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findOneForAnnotation(annotationId: ObjectId): Fox[Option[AnnotationLayerAlignment]] =
    for {
      rows <- run(q"""SELECT fixedLayerName, movingLayerName
                      FROM webknossos.annotation_layerAlignments
                      WHERE _annotation = $annotationId""".as[(String, String)])
    } yield rows.headOption.map { case (fixed, moving) => AnnotationLayerAlignment(fixed, moving) }

  def insertOneQuery(annotationId: ObjectId, alignment: AnnotationLayerAlignment): SqlAction[Int, NoStream, Effect] =
    q"""INSERT INTO webknossos.annotation_layerAlignments(_annotation, fixedLayerName, movingLayerName)
        VALUES($annotationId, ${alignment.fixedLayerName}, ${alignment.movingLayerName})""".asUpdate
}
