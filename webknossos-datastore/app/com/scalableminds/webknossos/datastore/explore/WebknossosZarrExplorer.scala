package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.tools.{Box, Failure, Fox, Full}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.datareaders.zarr.ZarrHeader
import com.scalableminds.webknossos.datastore.datareaders.zarr3.Zarr3ArrayHeader
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.helpers.UPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.{
  DataFormat,
  StaticColorLayer,
  StaticLayer,
  StaticSegmentationLayer,
  UsableDataSource
}

import scala.concurrent.ExecutionContext

class WebknossosZarrExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer {

  override def name: String = "WEBKNOSSOS-based Zarr"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(StaticLayer, VoxelSize)]] =
    for {
      dataSourcePropertiesPath <- Fox.successful(remotePath / UsableDataSource.FILENAME_DATASOURCE_PROPERTIES_JSON)
      dataSource <- dataSourcePropertiesPath.parseAsJson[UsableDataSource]
      zarrLayers <- Fox.serialCombined(dataSource.dataLayers) {
        case l: StaticSegmentationLayer =>
          for {
            headerFilename <- headerFilename(l).toFox
            mags <- adaptMags(l.mags, remotePath, l.name, headerFilename, credentialId)
          } yield l.copy(mags = mags)
        case l: StaticColorLayer =>
          for {
            headerFilename <- headerFilename(l).toFox
            mags <- adaptMags(l.mags, remotePath, l.name, headerFilename, credentialId)
          } yield l.copy(mags = mags)
        case layer =>
          Fox.failure(
            s"Encountered unsupported layer class ${layer.getClass} when exploring remote webknossos dataset.")
      }
      zarrLayersWithScale <- Fox.serialCombined(zarrLayers)(l => Fox.successful((l, dataSource.scale)))
    } yield zarrLayersWithScale

  private def headerFilename(layer: StaticLayer): Box[String] =
    layer.dataFormat match {
      case DataFormat.zarr  => Full(ZarrHeader.FILENAME_DOT_ZARRAY)
      case DataFormat.zarr3 => Full(Zarr3ArrayHeader.FILENAME_ZARR_JSON)
      case _                => Failure(s"Invalid layer dataformat ${layer.dataFormat}, can only explore zarr, zarr3 as WebknossosZarr")
    }

  private def adaptMags(mags: List[MagLocator],
                        remoteDatasetPath: VaultPath,
                        layerName: String,
                        headerFilename: String,
                        credentialId: Option[String])(implicit tc: TokenContext): Fox[List[MagLocator]] =
    Fox.serialCombined(mags)(m =>
      for {
        magPath <- fixRemoteMagPath(m, remoteDatasetPath, layerName, headerFilename)
      } yield m.copy(path = magPath, credentialId = credentialId))

  private def fixRemoteMagPath(mag: MagLocator,
                               remoteDatasetPath: VaultPath,
                               layerName: String,
                               headerFilename: String)(implicit tc: TokenContext): Fox[Option[UPath]] =
    mag.path match {
      case Some(path) => Fox.successful(Some(path.resolvedIn(remoteDatasetPath.toUPath)))
      case None       =>
        // Only scalar mag paths are attempted for now
        val magPath = remoteDatasetPath / layerName / mag.mag.toMagLiteral(allowScalar = true)
        val magHeaderPath = magPath / headerFilename
        for {
          _ <- magHeaderPath.readBytes() ?~> s"Could not find $magPath"
        } yield Some(magPath.toUPath)
    }

}
