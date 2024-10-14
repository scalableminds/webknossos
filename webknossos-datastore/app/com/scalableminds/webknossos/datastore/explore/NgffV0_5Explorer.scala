package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{Zarr3DataLayer, Zarr3Layer, Zarr3SegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.{NgffDataset, NgffLabelsGroup, NgffMultiscalesItemV0_5}
import com.scalableminds.webknossos.datastore.datareaders.zarr3.{Zarr3ArrayHeader, Zarr3GroupHeader}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{Category, DataLayerWithMagLocators}

import scala.concurrent.ExecutionContext

class NgffV0_5Explorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer with NgffExplorationUtils {

  override def name: String = "OME NGFF Zarr v0.5"

  override def explore(remotePath: VaultPath,
                       credentialId: Option[String]): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      zarrJsonPath <- Fox.successful(remotePath / Zarr3ArrayHeader.FILENAME_ZARR_JSON)
      groupHeader <- parseJsonFromPath[Zarr3GroupHeader](zarrJsonPath)
      ngffMetadata <- groupHeader.ngffMetadata.toFox
      labelLayers <- exploreLabelLayers(remotePath, credentialId).orElse(
        Fox.successful(List[(Zarr3Layer, VoxelSize)]()))

      layerLists: List[List[(Zarr3Layer, VoxelSize)]] <- Fox.serialCombined(ngffMetadata.multiscales)(multiscale => {
        for {
          channelCount <- getNgffMultiscaleChannelCount(multiscale, remotePath)
          channelAttributes = getChannelAttributes(ngffMetadata.omero)
          layers <- layersFromNgffMultiscale(multiscale, remotePath, credentialId, channelCount, channelAttributes)
        } yield layers
      })
      layers: List[(Zarr3Layer, VoxelSize)] = layerLists.flatten
    } yield layers ++ labelLayers

  private def layersFromNgffMultiscale(multiscale: NgffMultiscalesItemV0_5,
                                       remotePath: VaultPath,
                                       credentialId: Option[String],
                                       channelCount: Int,
                                       channelAttributes: Option[Seq[ChannelAttributes]] = None,
                                       isSegmentation: Boolean = false): Fox[List[(Zarr3Layer, VoxelSize)]] =
    for {
      axisOrder <- extractAxisOrder(multiscale.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      unifiedAxisUnit <- selectAxisUnit(multiscale.axes, axisOrder)
      axisUnitFactors <- extractAxisUnitFactors(unifiedAxisUnit, multiscale.axes, axisOrder) ?~> "Could not extract axis unit-to-nm factors"
      voxelSizeInAxisUnits <- extractVoxelSizeInAxisUnits(
        multiscale.datasets.map(_.coordinateTransformations),
        axisOrder) ?~> "Could not extract voxel size from scale transforms"
      voxelSizeFactor = voxelSizeInAxisUnits * axisUnitFactors
      nameFromPath = guessNameFromPath(remotePath)
      name = multiscale.name.getOrElse(nameFromPath)
      layerTuples <- Fox.serialCombined((0 until channelCount).toList)({ channelIndex: Int =>
        for {
          magsWithAttributes <- Fox.serialCombined(multiscale.datasets)(d =>
            zarrMagFromNgffDataset(d, remotePath, voxelSizeInAxisUnits, axisOrder, credentialId, Some(channelIndex)))
          _ <- bool2Fox(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
          elementClassRaw <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
          elementClass = if (isSegmentation) ensureElementClassForSegmentationLayer(elementClassRaw)
          else elementClassRaw

          (viewConfig: LayerViewConfiguration, channelName: String) = parseChannelAttributes(channelAttributes,
                                                                                             name,
                                                                                             channelIndex)

          boundingBox = boundingBoxFromMags(magsWithAttributes)
          additionalAxes <- getAdditionalAxes(multiscale, remotePath)
          layer: Zarr3Layer = if (looksLikeSegmentationLayer(name, elementClass) || isSegmentation) {
            Zarr3SegmentationLayer(
              channelName,
              boundingBox,
              elementClass,
              magsWithAttributes.map(_.mag),
              largestSegmentId = None,
              additionalAxes = Some(additionalAxes),
              defaultViewConfiguration = Some(viewConfig),
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
            )
        } yield (layer, VoxelSize(voxelSizeFactor, unifiedAxisUnit))
      })
    } yield layerTuples

  private def zarrMagFromNgffDataset(ngffDataset: NgffDataset,
                                     layerPath: VaultPath,
                                     voxelSizeInAxisUnits: Vec3Double,
                                     axisOrder: AxisOrder,
                                     credentialId: Option[String],
                                     channelIndex: Option[Int])(implicit ec: ExecutionContext): Fox[MagWithAttributes] =
    for {
      mag <- magFromTransforms(ngffDataset.coordinateTransformations, voxelSizeInAxisUnits, axisOrder) ?~> "Could not extract mag from scale transforms"
      magPath = layerPath / ngffDataset.path
      zarrJsonPath = magPath / Zarr3ArrayHeader.FILENAME_ZARR_JSON
      zarrHeader <- getZarrHeader(ngffDataset, layerPath)
      elementClass <- zarrHeader.elementClass ?~> s"failed to read element class from zarr header at $zarrJsonPath"
      boundingBox <- zarrHeader.boundingBox(axisOrder) ?~> s"failed to read bounding box from zarr header at $zarrJsonPath"
    } yield
      MagWithAttributes(
        MagLocator(mag, Some(magPath.toUri.toString), None, Some(axisOrder), channelIndex, credentialId),
        magPath,
        elementClass,
        boundingBox)

  private def getZarrHeader(ngffDataset: NgffDataset, layerPath: VaultPath): Fox[Zarr3ArrayHeader] = {
    val magPath = layerPath / ngffDataset.path
    val zarrJsonPath = magPath / Zarr3ArrayHeader.FILENAME_ZARR_JSON
    for {
      parsedHeader <- parseJsonFromPath[Zarr3ArrayHeader](zarrJsonPath) ?~> s"failed to read zarr header at $zarrJsonPath"
    } yield parsedHeader
  }

  override protected def getShape(dataset: NgffDataset, path: VaultPath): Fox[Array[Int]] =
    for {
      zarrHeader <- getZarrHeader(dataset, path)
      shape = zarrHeader.shape
    } yield shape

  private def exploreLabelLayers(remotePath: VaultPath,
                                 credentialId: Option[String]): Fox[List[(Zarr3Layer, VoxelSize)]] =
    for {
      labelDescriptionPath <- Fox.successful(remotePath / NgffLabelsGroup.LABEL_PATH)
      labelGroup <- parseJsonFromPath[NgffLabelsGroup](labelDescriptionPath)
      layerTuples <- Fox.serialCombined(labelGroup.labels) { labelPath =>
        layersForLabel(remotePath, labelPath, credentialId)
      }
    } yield layerTuples.flatten

  private def layersForLabel(remotePath: VaultPath,
                             labelPath: String,
                             credentialId: Option[String]): Fox[List[(Zarr3Layer, VoxelSize)]] =
    for {
      fullLabelPath <- Fox.successful(remotePath / "labels" / labelPath)
      zarrJsonPath = fullLabelPath / Zarr3ArrayHeader.FILENAME_ZARR_JSON
      groupHeader <- parseJsonFromPath[Zarr3GroupHeader](zarrJsonPath)
      ngffMetadata <- groupHeader.ngffMetadata.toFox
      layers: List[List[(Zarr3Layer, VoxelSize)]] <- Fox.serialCombined(ngffMetadata.multiscales)(
        multiscale =>
          layersFromNgffMultiscale(multiscale.copy(name = Some(s"labels-$labelPath")),
                                   fullLabelPath,
                                   credentialId,
                                   1,
                                   isSegmentation = true))
    } yield layers.flatten

}
