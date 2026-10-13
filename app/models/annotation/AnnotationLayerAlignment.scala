package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import play.api.libs.json.{Json, OFormat}
import slick.jdbc.PostgresProfile.api.*
import slick.sql.SqlAction
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Marks an annotation whose landmarks align the other layers of its dataset to the fixed layer.
case class AnnotationLayerAlignment(fixedLayerName: String) {
  // E.g. "l4_sample_with_… Alignment to color_1"
  def defaultAnnotationName(datasetName: String): String = {
    val maxDatasetNameLength = 15
    val shortDatasetName =
      if (datasetName.length > maxDatasetNameLength) s"${datasetName.take(maxDatasetNameLength)}…"
      else datasetName
    s"$shortDatasetName Alignment to $fixedLayerName"
  }
}

object AnnotationLayerAlignment {
  implicit val jsonFormat: OFormat[AnnotationLayerAlignment] = Json.format[AnnotationLayerAlignment]
}

class AnnotationLayerAlignmentDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findOneForAnnotation(annotationId: ObjectId): Fox[Option[AnnotationLayerAlignment]] =
    for {
      rows <- run(q"""SELECT fixedLayerName
                      FROM webknossos.annotation_layerAlignments
                      WHERE _annotation = $annotationId""".as[String])
    } yield rows.headOption.map(AnnotationLayerAlignment(_))

  def insertOneQuery(annotationId: ObjectId, alignment: AnnotationLayerAlignment): SqlAction[Int, NoStream, Effect] =
    q"""INSERT INTO webknossos.annotation_layerAlignments(_annotation, fixedLayerName)
        VALUES($annotationId, ${alignment.fixedLayerName})""".asUpdate
}
