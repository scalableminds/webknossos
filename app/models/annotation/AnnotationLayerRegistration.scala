package models.annotation

import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import play.api.libs.json.{Json, OFormat}
import slick.jdbc.PostgresProfile.api.*
import slick.sql.SqlAction
import utils.sql.{SimpleSQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Marks an annotation whose landmarks register the other layers of its dataset to the fixed layer.
case class AnnotationLayerRegistration(fixedLayerName: String) {
  // E.g. "l4_sample_with_… Layer registration to color_1"
  def defaultAnnotationName(datasetName: String): String = {
    val maxDatasetNameLength = 15
    val shortDatasetName =
      if (datasetName.length > maxDatasetNameLength) s"${datasetName.take(maxDatasetNameLength)}…"
      else datasetName
    s"$shortDatasetName Layer registration to $fixedLayerName"
  }
}

object AnnotationLayerRegistration {
  implicit val jsonFormat: OFormat[AnnotationLayerRegistration] = Json.format[AnnotationLayerRegistration]
}

class AnnotationLayerRegistrationDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {

  def findOneForAnnotation(annotationId: ObjectId): Fox[Option[AnnotationLayerRegistration]] =
    for {
      rows <- run(q"""SELECT fixedLayerName
                      FROM webknossos.annotation_layerRegistrations
                      WHERE _annotation = $annotationId""".as[String])
    } yield rows.headOption.map(AnnotationLayerRegistration(_))

  def insertOneQuery(
      annotationId: ObjectId,
      layerRegistration: AnnotationLayerRegistration
  ): SqlAction[Int, NoStream, Effect] =
    q"""INSERT INTO webknossos.annotation_layerRegistrations(_annotation, fixedLayerName)
        VALUES($annotationId, ${layerRegistration.fixedLayerName})""".asUpdate
}
