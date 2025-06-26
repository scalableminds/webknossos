package com.scalableminds.webknossos.datastore.services.connectome

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.datareaders.DatasetArray
import com.scalableminds.webknossos.datastore.services.mesh.{MeshFileAttributes, MeshFileKey}
import com.scalableminds.webknossos.datastore.storage.RemoteSourceDescriptorService
import jakarta.inject.Inject
import play.api.libs.json.{JsResult, JsValue, Reads}

import scala.concurrent.ExecutionContext

case class ConnectomeFileAttributes(
    formatVersion: Long,
    mappingName: String,
    synapseTypeNames: Seq[String]
)

object ConnectomeFileAttributes {
  val FILENAME_ZARR_JSON = "zarr.json"

  implicit object ConnectomeFileAttributesZarr3GroupHeaderReads extends Reads[ConnectomeFileAttributes] {
    override def reads(json: JsValue): JsResult[ConnectomeFileAttributes] = {
      val keyAttributes = "attributes"
      val keyVx = "voxelytics"
      val keyFormatVersion = "artifact_schema_version"
      val keyArtifactAttrs = "artifact_attributes"
      val connectomeFileAttrs = json \ keyAttributes \ keyVx \ keyArtifactAttrs
      for {
        formatVersion <- (json \ keyAttributes \ keyVx \ keyFormatVersion).validate[Long]
        mappingName <- (connectomeFileAttrs \ "mapping_name").validate[String]
        synapseTypeNames <- (connectomeFileAttrs \ "synapse_type_names").validate[Seq[String]]
      } yield
        ConnectomeFileAttributes(
          formatVersion,
          mappingName,
          synapseTypeNames
        )
    }
  }
}

class ZarrConnectomeFileService @Inject()(remoteSourceDescriptorService: RemoteSourceDescriptorService)
    extends FoxImplicits {
  private lazy val openArraysCache = AlfuCache[(ConnectomeFileKey, String), DatasetArray]()
  private lazy val attributesCache = AlfuCache[ConnectomeFileKey, ConnectomeFileAttributes]()

  private def readConnectomeFileAttributes(connectomeFileKey: ConnectomeFileKey)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[ConnectomeFileAttributes] =
    attributesCache.getOrLoad(
      connectomeFileKey,
      _ =>
        for {
          groupVaultPath <- remoteSourceDescriptorService.vaultPathFor(connectomeFileKey.attachment)
          groupHeaderBytes <- (groupVaultPath / ConnectomeFileAttributes.FILENAME_ZARR_JSON).readBytes()
          connectomeFileAttributes <- JsonHelper
            .parseAs[ConnectomeFileAttributes](groupHeaderBytes)
            .toFox ?~> "Could not parse connectome file attributes from zarr group file"
        } yield connectomeFileAttributes
    )

  def mappingNameForConnectomeFile(connectomeFileKey: ConnectomeFileKey)(implicit ec: ExecutionContext,
                                                                         tc: TokenContext): Fox[String] =
    for {
      attributes <- readConnectomeFileAttributes(connectomeFileKey)
    } yield attributes.mappingName

  def synapsesForAgglomerates(connectomeFileKey: ConnectomeFileKey, agglomerateIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[DirectedSynapseList]] = ???

  def synapticPartnerForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long], direction: String)(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[Long]] = ???

  def positionsForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[List[List[Long]]] = ???

  def typesForSynapses(connectomeFileKey: ConnectomeFileKey, synapseIds: List[Long])(
      implicit ec: ExecutionContext,
      tc: TokenContext): Fox[SynapseTypesWithLegend] = ???

}
