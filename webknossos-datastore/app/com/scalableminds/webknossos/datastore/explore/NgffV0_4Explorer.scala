package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr._
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataFormat, DataLayerWithMagLocators}

import scala.concurrent.ExecutionContext

class NgffV0_4Explorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer with NgffExplorationUtils {

  override def name: String = "OME NGFF Zarr v0.4"

  override def explore(remotePath: VaultPath,
                       credentialId: Option[String]): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      zattrsPath <- Fox.successful(remotePath / NgffMetadata.FILENAME_DOT_ZATTRS)
      ngffHeader <- zattrsPath.parseAsJson[NgffMetadata] ?~> s"Failed to read OME NGFF header at $zattrsPath"
      labelLayers <- exploreLabelLayers(remotePath, credentialId).orElse(
        Fox.successful(List[(DataLayerWithMagLocators, VoxelSize)]()))

      layerLists: List[List[(DataLayerWithMagLocators, VoxelSize)]] <- Fox.serialCombined(ngffHeader.multiscales)(
        multiscale => {
          for {
            channelCount <- getNgffMultiscaleChannelCount(multiscale, remotePath)
            channelAttributes = getChannelAttributes(ngffHeader.omero)
            layers <- layersFromNgffMultiscale(multiscale, remotePath, credentialId, channelCount, channelAttributes)
          } yield layers
        })
      layers: List[(DataLayerWithMagLocators, VoxelSize)] = layerLists.flatten
    } yield layers ++ labelLayers

  protected def createLayer(remotePath: VaultPath,
                            credentialId: Option[String],
                            multiscale: NgffMultiscalesItem,
                            channelIndex: Int,
                            channelAttributes: Option[Seq[ChannelAttributes]],
                            datasetName: String,
                            voxelSizeInAxisUnits: Vec3Double,
                            axisOrder: AxisOrder,
                            isSegmentation: Boolean): Fox[(ZarrLayer)] =
    for {
      magsWithAttributes <- Fox.serialCombined(multiscale.datasets)(d =>
        zarrMagFromNgffDataset(d, remotePath, voxelSizeInAxisUnits, axisOrder, credentialId, Some(channelIndex)))
      _ <- bool2Fox(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
      elementClassRaw <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
      elementClass = if (isSegmentation) ensureElementClassForSegmentationLayer(elementClassRaw)
      else elementClassRaw

      (viewConfig: LayerViewConfiguration, channelName: String) = parseChannelAttributes(channelAttributes,
                                                                                         datasetName,
                                                                                         channelIndex)
      boundingBox = boundingBoxFromMags(magsWithAttributes)
      additionalAxes <- getAdditionalAxes(multiscale, remotePath)
      translationOpt = getTranslation(multiscale)
      layer: ZarrLayer = if (looksLikeSegmentationLayer(datasetName, elementClass) || isSegmentation) {
        ZarrSegmentationLayer(
          channelName,
          boundingBox,
          elementClass,
          magsWithAttributes.map(_.mag),
          largestSegmentId = None,
          additionalAxes = Some(additionalAxes),
          defaultViewConfiguration = Some(viewConfig),
          coordinateTransformations = translationOpt,
          dataFormat = DataFormat.zarr
        )
      } else
        ZarrDataLayer(
          channelName,
          Category.color,
          boundingBox,
          elementClass,
          magsWithAttributes.map(_.mag),
          additionalAxes = Some(additionalAxes),
          defaultViewConfiguration = Some(viewConfig),
          coordinateTransformations = translationOpt,
          dataFormat = DataFormat.zarr
        )
    } yield layer

  private def getZarrHeader(ngffDataset: NgffDataset, layerPath: VaultPath) = {
    val magPath = layerPath / ngffDataset.path
    val zarrayPath = magPath / ZarrHeader.FILENAME_DOT_ZARRAY
    for {
      parsedHeader <- zarrayPath.parseAsJson[ZarrHeader] ?~> s"failed to read zarr header at $zarrayPath"
      header = parsedHeader.shape.length match {
        case 2 =>
          parsedHeader.copy(shape = parsedHeader.shape ++ Array(1), chunks = parsedHeader.chunks ++ Array(1))
        case _ => parsedHeader
      }
    } yield header
  }

  private def zarrMagFromNgffDataset(ngffDataset: NgffDataset,
                                     layerPath: VaultPath,
                                     voxelSizeInAxisUnits: Vec3Double,
                                     axisOrder: AxisOrder,
                                     credentialId: Option[String],
                                     channelIndex: Option[Int])(implicit ec: ExecutionContext): Fox[MagWithAttributes] =
    for {
      mag <- magFromTransforms(ngffDataset.coordinateTransformations, voxelSizeInAxisUnits, axisOrder) ?~> "Could not extract mag from scale transforms"
      magPath = layerPath / ngffDataset.path
      zarrayPath = magPath / ZarrHeader.FILENAME_DOT_ZARRAY
      zarrHeader <- getZarrHeader(ngffDataset, layerPath)
      elementClass <- zarrHeader.elementClass ?~> s"failed to read element class from zarr header at $zarrayPath"
      boundingBox <- zarrHeader.boundingBox(axisOrder) ?~> s"failed to read bounding box from zarr header at $zarrayPath"
    } yield
      MagWithAttributes(
        MagLocator(mag, Some(magPath.toUri.toString), None, Some(axisOrder), channelIndex, credentialId),
        magPath,
        elementClass,
        boundingBox)

  protected def getShape(dataset: NgffDataset, path: VaultPath): Fox[Array[Int]] =
    for {
      zarrHeader <- getZarrHeader(dataset, path)
      shape = zarrHeader.shape
    } yield shape

  protected def layersForLabel(remotePath: VaultPath,
                               labelPath: String,
                               credentialId: Option[String]): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      fullLabelPath <- Fox.successful(remotePath / "labels" / labelPath)
      zattrsPath = fullLabelPath / NgffMetadata.FILENAME_DOT_ZATTRS
      ngffHeader <- zattrsPath.parseAsJson[NgffMetadata] ?~> s"Failed to read OME NGFF header at $zattrsPath"
      layers: List[List[(DataLayerWithMagLocators, VoxelSize)]] <- Fox.serialCombined(ngffHeader.multiscales)(
        multiscale =>
          layersFromNgffMultiscale(multiscale.copy(name = Some(s"labels-$labelPath")),
                                   fullLabelPath,
                                   credentialId,
                                   1,
                                   isSegmentation = true))
    } yield layers.flatten

}
