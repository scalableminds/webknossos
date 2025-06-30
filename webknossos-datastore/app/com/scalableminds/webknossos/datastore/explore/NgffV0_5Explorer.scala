package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{Zarr3DataLayer, Zarr3Layer, Zarr3SegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffDataset, NgffMultiscalesItem}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{Zarr3ArrayHeader, NgffZarr3GroupHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayerWithMagLocators}

import scala.concurrent.ExecutionContext

class NgffV0_5Explorer(implicit val ec: ExecutionContext)
    extends RemoteLayerExplorer
    with NgffExplorationUtils
    with FoxImplicits {

  override def name: String = "OME NGFF Zarr v0.5"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      zarrJsonPath <- Fox.successful(remotePath / Zarr3ArrayHeader.FILENAME_ZARR_JSON)
      groupHeader <- zarrJsonPath
        .parseAsJson[NgffZarr3GroupHeader] ?~> s"Failed to read OME NGFF header at $zarrJsonPath"
      labelLayers <- exploreLabelLayers(remotePath, credentialId).orElse(
        Fox.successful(List[(Zarr3Layer, VoxelSize)]()))

      layerLists: List[List[(DataLayerWithMagLocators, VoxelSize)]] <- Fox.serialCombined(
        groupHeader.ngffMetadata.multiscales)(multiscale => {
        for {
          channelCount <- getNgffMultiscaleChannelCount(multiscale, remotePath)
          channelAttributes = getChannelAttributes(groupHeader.ngffMetadata.omero)
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
                            isSegmentation: Boolean)(implicit tc: TokenContext): Fox[DataLayerWithMagLocators] =
    for {
      magsWithAttributes <- Fox.serialCombined(multiscale.datasets)(d =>
        zarrMagFromNgffDataset(d, remotePath, voxelSizeInAxisUnits, axisOrder, credentialId, Some(channelIndex)))
      _ <- Fox.fromBool(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
      elementClassRaw <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
      elementClass = if (isSegmentation) ensureElementClassForSegmentationLayer(elementClassRaw)
      else elementClassRaw

      (viewConfig: LayerViewConfiguration, channelName: String) = parseChannelAttributes(channelAttributes,
                                                                                         datasetName,
                                                                                         channelIndex)

      boundingBox = boundingBoxFromMags(magsWithAttributes)
      additionalAxes <- getAdditionalAxes(multiscale, remotePath)
      translationOpt = getTranslation(multiscale)
      layer: Zarr3Layer = if (looksLikeSegmentationLayer(datasetName, elementClass) || isSegmentation) {
        Zarr3SegmentationLayer(
          channelName,
          boundingBox,
          elementClass,
          magsWithAttributes.map(_.mag),
          largestSegmentId = None,
          additionalAxes = Some(additionalAxes),
          defaultViewConfiguration = Some(viewConfig),
          coordinateTransformations = translationOpt,
        )
      } else
        Zarr3DataLayer(
          channelName,
          Category.color,
          boundingBox,
          elementClass,
          magsWithAttributes.map(_.mag),
          additionalAxes = Some(additionalAxes),
          defaultViewConfiguration = Some(viewConfig),
          coordinateTransformations = translationOpt,
        )
    } yield layer

  private def getZarrHeader(ngffDataset: NgffDataset, layerPath: VaultPath)(
      implicit tc: TokenContext): Fox[Zarr3ArrayHeader] = {
    val magPath = layerPath / ngffDataset.path
    val zarrJsonPath = magPath / Zarr3ArrayHeader.FILENAME_ZARR_JSON
    for {
      parsedHeader <- zarrJsonPath.parseAsJson[Zarr3ArrayHeader] ?~> s"failed to read zarr header at $zarrJsonPath"
    } yield parsedHeader
  }

  private def zarrMagFromNgffDataset(
      ngffDataset: NgffDataset,
      layerPath: VaultPath,
      voxelSizeInAxisUnits: Vec3Double,
      axisOrder: AxisOrder,
      credentialId: Option[String],
      channelIndex: Option[Int])(implicit ec: ExecutionContext, tc: TokenContext): Fox[MagWithAttributes] =
    for {
      mag <- magFromTransforms(ngffDataset.coordinateTransformations, voxelSizeInAxisUnits, axisOrder) ?~> "Could not extract mag from scale transforms"
      magPath = layerPath / ngffDataset.path
      zarrJsonPath = magPath / Zarr3ArrayHeader.FILENAME_ZARR_JSON
      zarrHeader <- getZarrHeader(ngffDataset, layerPath)
      elementClass <- zarrHeader.elementClass.toFox ?~> s"failed to read element class from zarr header at $zarrJsonPath"
      boundingBox <- zarrHeader
        .boundingBox(axisOrder)
        .toFox ?~> s"failed to read bounding box from zarr header at $zarrJsonPath"
    } yield
      MagWithAttributes(
        MagLocator(mag, Some(magPath.toUri.toString), None, Some(axisOrder), channelIndex, credentialId),
        magPath,
        elementClass,
        boundingBox)

  protected def getShape(dataset: NgffDataset, path: VaultPath)(implicit tc: TokenContext): Fox[Array[Long]] =
    for {
      zarrHeader <- getZarrHeader(dataset, path)
      shape = zarrHeader.shape
    } yield shape

  protected def layersForLabel(remotePath: VaultPath, labelPath: String, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      fullLabelPath <- Fox.successful(remotePath / "labels" / labelPath)
      zarrJsonPath = fullLabelPath / Zarr3ArrayHeader.FILENAME_ZARR_JSON
      groupHeader <- zarrJsonPath.parseAsJson[NgffZarr3GroupHeader]
      layers: List[List[(DataLayerWithMagLocators, VoxelSize)]] <- Fox.serialCombined(
        groupHeader.ngffMetadata.multiscales)(
        multiscale =>
          layersFromNgffMultiscale(multiscale.copy(name = Some(s"labels-$labelPath")),
                                   fullLabelPath,
                                   credentialId,
                                   1,
                                   isSegmentation = true))
    } yield layers.flatten

}
