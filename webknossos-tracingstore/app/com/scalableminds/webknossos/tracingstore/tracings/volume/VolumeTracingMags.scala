package com.scalableminds.webknossos.tracingstore.tracings.volume

import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerLike, DataSourceLike}
import com.scalableminds.webknossos.datastore.VolumeTracing.VolumeTracing
import com.scalableminds.webknossos.datastore.geometry.{Vec3IntProto => ProtoPoint3D}
import com.scalableminds.webknossos.datastore.helpers.ProtoGeometryImplicits
import play.api.libs.json.{Format, Json}

object VolumeTracingMags extends ProtoGeometryImplicits {

  def magsForVolumeTracing(dataSource: DataSourceLike, fallbackLayer: Option[DataLayerLike]): List[Vec3Int] = {
    val fallbackLayerMags = fallbackLayer.map(_.resolutions)
    fallbackLayerMags.getOrElse {
      val unionOfAllLayers = dataSource.dataLayers.flatMap(_.resolutions).distinct
      val unionHasDistinctMaxDims = unionOfAllLayers.map(_.maxDim).distinct.length == unionOfAllLayers.length
      if (unionHasDistinctMaxDims) {
        unionOfAllLayers
      } else {
        // If the union of all layer’s mags has conflicting mags (meaning non-distinct maxDims, e.g. 2-2-1 and 2-2-2),
        // instead use one layer as template. Use the layer with the most mags.
        dataSource.dataLayers.maxBy(_.resolutions.length).resolutions.distinct
      }
    }.sortBy(_.maxDim)
  }

  def restrictMagList(tracing: VolumeTracing, magRestrictions: MagRestrictions): VolumeTracing = {
    val tracingMags =
      resolveLegacyMagList(tracing.mags)
    val allowedMags = magRestrictions.filterAllowed(tracingMags.map(vec3IntFromProto))
    tracing.withMags(allowedMags.map(vec3IntToProto))
  }

  def resolveLegacyMagList(mags: Seq[ProtoPoint3D]): Seq[ProtoPoint3D] =
    if (mags.isEmpty) Seq(ProtoPoint3D(1, 1, 1)) else mags
}

object MagRestrictions {
  def empty: MagRestrictions = MagRestrictions(None, None)
  implicit val jsonFormat: Format[MagRestrictions] = Json.format[MagRestrictions]
}

case class MagRestrictions(
    min: Option[Int],
    max: Option[Int]
) {
  def filterAllowed(mags: Seq[Vec3Int]): Seq[Vec3Int] =
    mags.filter(isAllowed)

  def isAllowed(mag: Vec3Int): Boolean =
    min.getOrElse(0) <= mag.maxDim && max.getOrElse(Int.MaxValue) >= mag.maxDim

  def isForbidden(mag: Vec3Int): Boolean = !isAllowed(mag)

  def minStr: Option[String] = min.map(_.toString)
  def maxStr: Option[String] = max.map(_.toString)
}
