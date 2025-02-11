package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{
  Zarr3DataLayer,
  Zarr3SegmentationLayer,
  ZarrDataLayer,
  ZarrSegmentationLayer
}
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrHeader
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataLayerWithMagLocators,
  DataSource,
  GenericDataSource
}

import scala.concurrent.ExecutionContext

class WebknossosZarrExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer {

  override def name: String = "WEBKNOSSOS-based Zarr"

  override def explore(
      remotePath: VaultPath,
      credentialId: Option[String]
  ): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      dataSourcePropertiesPath <- Fox.successful(remotePath / GenericDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
      dataSource <- dataSourcePropertiesPath.parseAsJson[DataSource]
      zarrLayers <- Fox.serialCombined(dataSource.dataLayers) {
        case l: Zarr3SegmentationLayer =>
          for {
            mags <- adaptMags(l.mags, remotePath / l.name, Zarr3ArrayHeader.FILENAME_ZARR_JSON, credentialId)
          } yield l.copy(mags = mags)
        case l: Zarr3DataLayer =>
          for {
            mags <- adaptMags(l.mags, remotePath / l.name, Zarr3ArrayHeader.FILENAME_ZARR_JSON, credentialId)
          } yield l.copy(mags = mags)
        case l: ZarrSegmentationLayer =>
          for {
            mags <- adaptMags(l.mags, remotePath / l.name, ZarrHeader.FILENAME_DOT_ZARRAY, credentialId)
          } yield l.copy(mags = mags)
        case l: ZarrDataLayer =>
          for {
            mags <- adaptMags(l.mags, remotePath / l.name, ZarrHeader.FILENAME_DOT_ZARRAY, credentialId)
          } yield l.copy(mags = mags)
        case layer => Fox.failure(s"Only remote Zarr2 or Zarr3 layers are supported, got ${layer.getClass}.")
      }
      zarrLayersWithScale <- Fox.serialCombined(zarrLayers)(l => Fox.successful((l, dataSource.scale)))
    } yield zarrLayersWithScale

  private def adaptMags(
      mags: List[MagLocator],
      remoteLayerPath: VaultPath,
      headerFilename: String,
      credentialId: Option[String]
  ): Fox[List[MagLocator]] =
    Fox.serialCombined(mags)(m =>
      for {
        magPath <- fixRemoteMagPath(m, remoteLayerPath, headerFilename)
      } yield m.copy(path = magPath, credentialId = credentialId)
    )

  private def fixRemoteMagPath(
      mag: MagLocator,
      remoteLayerPath: VaultPath,
      headerFilename: String
  ): Fox[Option[String]] =
    mag.path match {
      case Some(path) => Fox.successful(Some(path))
      case None       =>
        // Only scalar mag paths are attempted for now
        val magPath = remoteLayerPath / mag.mag.toMagLiteral(allowScalar = true)
        val magHeaderPath = magPath / headerFilename
        for {
          _ <- magHeaderPath.readBytes() ?~> s"Could not find $magPath"
        } yield Some(magPath.toUri.toString)
    }

}
