package com.scalableminds.webknossos.datastore.services

import com.google.inject.Inject
import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.option2Fox
import com.scalableminds.webknossos.datastore.models.AdditionalCoordinate
import play.api.i18n.MessagesProvider
import play.api.libs.json.{Json, OFormat}

import scala.concurrent.ExecutionContext

case class FullMeshRequest(
    meshFileName: Option[String], // None means ad-hoc meshing
    lod: Option[Int],
    segmentId: Long, // if mappingName is set, this is an agglomerate id
    mappingName: Option[String],
    mappingType: Option[String], // json, agglomerate, editableMapping
    mag: Option[Vec3Int],
    subsamplingStrides: Option[Vec3Int],
    seedPosition: Option[Vec3Double], // required for ad-hoc meshing
    additionalCoordinates: Option[Seq[AdditionalCoordinate]] = None,
)

object FullMeshRequest {
  implicit val jsonFormat: OFormat[FullMeshRequest] = Json.format[FullMeshRequest]
}

class FullMeshService @Inject()(dataSourceRepository: DataSourceRepository) {
  def loadFor(token: Option[String],
              organizationName: String,
              datasetName: String,
              dataLayerName: String,
              fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, m: MessagesProvider): Fox[Array[Byte]] =
    fullMeshRequest.meshFileName match {
      case Some(_) =>
        loadFullMeshFromMeshfile(token, organizationName, datasetName, dataLayerName, fullMeshRequest)
      case None => loadFullMeshFromAdHoc(token, organizationName, datasetName, dataLayerName, fullMeshRequest)
    }

  private def loadFullMeshFromAdHoc(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext, m: MessagesProvider): Fox[Array[Byte]] =
    for {
      mag <- fullMeshRequest.mag.toFox ?~> "mag.needeForAdHoc"
      subsamplingStrides <- fullMeshRequest.subsamplingStrides.toFox ?~> "subsamplingStrides.needeForAdHoc"
      (dataSource, dataLayer) <- dataSourceRepository.getDataSourceAndDataLayer(organizationName,
                                                                                datasetName,
                                                                                dataLayerName)
      // TODO seed position
      // TODO gather chunks from adHocMeshActor (pass the mapping there if exists)
      // TODO use neighbors logic
      // TODO: puzzle them together
      // TODO: simplify
    } yield Array[Byte](0)

  private def loadFullMeshFromMeshfile(
      token: Option[String],
      organizationName: String,
      datasetName: String,
      dataLayerName: String,
      fullMeshRequest: FullMeshRequest)(implicit ec: ExecutionContext): Fox[Array[Byte]] = ???

  // TODO: find out if meshfile exists, has right format, and whether it was computed for the selected mapping
  // TODO: unmap segment ids if needed
  // TODO: fetch all required chunks for segment ids from meshfile
  // TODO: puzzle them together
  // TODO: simplify
}
