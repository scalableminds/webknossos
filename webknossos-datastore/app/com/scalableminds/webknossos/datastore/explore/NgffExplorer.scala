package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.{Fox, TextUtils}
import com.scalableminds.webknossos.datastore.dataformats.MagLocator
import com.scalableminds.webknossos.datastore.dataformats.layers.{ZarrDataLayer, ZarrLayer, ZarrSegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr._
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.LengthUnit.LengthUnit
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  Category,
  DataFormat,
  ElementClass,
  LayerViewConfiguration
}
import play.api.libs.json.{JsArray, JsBoolean, JsNumber, Json}

import scala.concurrent.ExecutionContext

class NgffExplorer(implicit val ec: ExecutionContext) extends RemoteLayerExplorer {

  override def name: String = "OME NGFF Zarr v0.4"

  override def explore(remotePath: VaultPath, credentialId: Option[String]): Fox[List[(ZarrLayer, VoxelSize)]] =
    for {
      zattrsPath <- Fox.successful(remotePath / NgffMetadata.FILENAME_DOT_ZATTRS)
      ngffHeader <- parseJsonFromPath[NgffMetadata](zattrsPath) ?~> s"Failed to read OME NGFF header at $zattrsPath"
      labelLayers <- exploreLabelLayers(remotePath, credentialId).orElse(Fox.successful(List[(ZarrLayer, VoxelSize)]()))

      layerLists: List[List[(ZarrLayer, VoxelSize)]] <- Fox.serialCombined(ngffHeader.multiscales)(multiscale => {
        for {
          channelCount: Int <- getNgffMultiscaleChannelCount(multiscale, remotePath)
          channelAttributes = getChannelAttributes(ngffHeader)
          layers <- layersFromNgffMultiscale(multiscale, remotePath, credentialId, channelCount, channelAttributes)
        } yield layers
      })
      layers: List[(ZarrLayer, VoxelSize)] = layerLists.flatten
    } yield layers ++ labelLayers

  private def getNgffMultiscaleChannelCount(multiscale: NgffMultiscalesItem, remotePath: VaultPath): Fox[Int] =
    for {
      firstDataset <- multiscale.datasets.headOption.toFox
      magPath = remotePath / firstDataset.path
      zarrayPath = magPath / ZarrHeader.FILENAME_DOT_ZARRAY
      zarrHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
      axisOrder <- extractAxisOrder(multiscale.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      channelCount = axisOrder.c match {
        case Some(channeAxislIndex) => zarrHeader.shape(channeAxislIndex)
        case _                      => 1
      }
    } yield channelCount

  private def layersFromNgffMultiscale(multiscale: NgffMultiscalesItem,
                                       remotePath: VaultPath,
                                       credentialId: Option[String],
                                       channelCount: Int,
                                       channelAttributes: Option[Seq[ChannelAttributes]] = None,
                                       isSegmentation: Boolean = false): Fox[List[(ZarrLayer, VoxelSize)]] =
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

          (viewConfig: LayerViewConfiguration, channelName: String) = channelAttributes match {
            case Some(attributes) => {
              val thisChannelAttributes = attributes(channelIndex)
              val attributeName: String =
                thisChannelAttributes.name
                  .map(TextUtils.normalizeStrong(_).getOrElse(name).replaceAll(" ", ""))
                  .getOrElse(name)

              val layerViewConfiguration = (thisChannelAttributes.color match {
                case Some(c) => Seq("color" -> JsArray(c.toArrayOfInts.map(i => JsNumber(BigDecimal(i)))))
                case None    => Seq()
              }) ++ (thisChannelAttributes.window match {
                case Some(w) =>
                  Seq("intensityRange" -> Json.arr(JsNumber(w.start), JsNumber(w.end)),
                      "min" -> JsNumber(w.min),
                      "max" -> JsNumber(w.max))
                case None => Seq()
              }) ++ (thisChannelAttributes.inverted match {
                case Some(i) => Seq("isInverted" -> JsBoolean(i))
                case None    => Seq()
              }) ++ (thisChannelAttributes.active match {
                case Some(a) => Seq("isDisabled" -> JsBoolean(!a))
                case None    => Seq()
              })

              (if (layerViewConfiguration.isEmpty) {
                LayerViewConfiguration.empty
              } else {
                layerViewConfiguration.toMap
              }, attributeName)
            }
            case None => (LayerViewConfiguration.empty, name)
          }

          boundingBox = boundingBoxFromMags(magsWithAttributes)
          additionalAxes <- getAdditionalAxes(multiscale, remotePath)
          layer: ZarrLayer = if (looksLikeSegmentationLayer(name, elementClass) || isSegmentation) {
            ZarrSegmentationLayer(
              channelName,
              boundingBox,
              elementClass,
              magsWithAttributes.map(_.mag),
              largestSegmentId = None,
              additionalAxes = Some(additionalAxes),
              defaultViewConfiguration = Some(viewConfig),
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
              dataFormat = DataFormat.zarr
            )
        } yield (layer, VoxelSize(voxelSizeFactor, unifiedAxisUnit))
      })
    } yield layerTuples

  private def getAdditionalAxes(multiscale: NgffMultiscalesItem, remotePath: VaultPath): Fox[Seq[AdditionalAxis]] = {
    val defaultAxes = List("c", "x", "y", "z")
    for {
      // Selecting shape of first mag, assuming no mags for additional coordinates
      dataset <- Fox.option2Fox(multiscale.datasets.headOption)
      zarrHeader <- getZarrHeader(dataset, remotePath)
      shape = zarrHeader.shape
      axes <- Fox.combined(
        multiscale.axes
          .filter(axis => !defaultAxes.contains(axis.name))
          .zipWithIndex
          .map(axisAndIndex =>
            createAdditionalAxis(axisAndIndex._1.name, axisAndIndex._2, Array(0, shape(axisAndIndex._2))).toFox))
      duplicateNames = axes.map(_.name).diff(axes.map(_.name).distinct).distinct
      _ <- Fox.bool2Fox(duplicateNames.isEmpty) ?~> s"Additional axes names (${duplicateNames.mkString("", ", ", "")}) are not unique."
    } yield axes
  }

  private case class ChannelAttributes(color: Option[Color],
                                       name: Option[String],
                                       window: Option[NgffChannelWindow],
                                       inverted: Option[Boolean],
                                       active: Option[Boolean])

  private def getChannelAttributes(
      ngffHeader: NgffMetadata
  ): Option[Seq[ChannelAttributes]] =
    ngffHeader.omero match {
      case Some(value) =>
        Some(
          value.channels.map(omeroChannelAttributes =>
            ChannelAttributes(
              omeroChannelAttributes.color.map(Color.fromHTML(_).getOrElse(Color(1, 1, 1, 0))),
              omeroChannelAttributes.label,
              omeroChannelAttributes.window,
              omeroChannelAttributes.inverted,
              omeroChannelAttributes.active
          )))
      case None => None
    }

  private def exploreLabelLayers(remotePath: VaultPath,
                                 credentialId: Option[String]): Fox[List[(ZarrLayer, VoxelSize)]] =
    for {
      labelDescriptionPath <- Fox.successful(remotePath / NgffLabelsGroup.LABEL_PATH)
      labelGroup <- parseJsonFromPath[NgffLabelsGroup](labelDescriptionPath)
      layerTuples <- Fox.serialCombined(labelGroup.labels) { labelPath =>
        layersForLabel(remotePath, labelPath, credentialId)
      }
    } yield layerTuples.flatten

  private def layersForLabel(remotePath: VaultPath,
                             labelPath: String,
                             credentialId: Option[String]): Fox[List[(ZarrLayer, VoxelSize)]] =
    for {
      fullLabelPath <- Fox.successful(remotePath / "labels" / labelPath)
      zattrsPath = fullLabelPath / NgffMetadata.FILENAME_DOT_ZATTRS
      ngffHeader <- parseJsonFromPath[NgffMetadata](zattrsPath) ?~> s"Failed to read OME NGFF header at $zattrsPath"
      layers: List[List[(ZarrLayer, VoxelSize)]] <- Fox.serialCombined(ngffHeader.multiscales)(
        multiscale =>
          layersFromNgffMultiscale(multiscale.copy(name = Some(s"labels-$labelPath")),
                                   fullLabelPath,
                                   credentialId,
                                   1,
                                   isSegmentation = true))
    } yield layers.flatten

  private def ensureElementClassForSegmentationLayer(e: ElementClass.Value): ElementClass.Value =
    e match {
      case ElementClass.int8  => ElementClass.uint8
      case ElementClass.int16 => ElementClass.uint16
      case ElementClass.int32 => ElementClass.uint32
      case ElementClass.int64 => ElementClass.uint64
      case _                  => e
    }

  private def getZarrHeader(ngffDataset: NgffDataset, layerPath: VaultPath) = {
    val magPath = layerPath / ngffDataset.path
    val zarrayPath = magPath / ZarrHeader.FILENAME_DOT_ZARRAY
    for {
      parsedHeader <- parseJsonFromPath[ZarrHeader](zarrayPath) ?~> s"failed to read zarr header at $zarrayPath"
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

  private def extractAxisOrder(axes: List[NgffAxis]): Fox[AxisOrder] = {
    def axisMatches(axis: NgffAxis, name: String) = axis.name.toLowerCase == name && axis.`type` == "space"

    val x = axes.indexWhere(axisMatches(_, "x"))
    val y = axes.indexWhere(axisMatches(_, "y"))
    val z = axes.indexWhere(axisMatches(_, "z"))
    val c = axes.indexWhere(_.`type` == "channel")
    val cOpt = if (c == -1) None else Some(c)
    for {
      _ <- bool2Fox(x >= 0 && y >= 0) ?~> s"invalid xyz axis order: $x,$y,$z. ${x >= 0 && y >= 0}"
    } yield
      if (z >= 0) {
        AxisOrder(x, y, Some(z), cOpt)
      } else {
        AxisOrder(x, y, None, cOpt)
      }
  }

  private def selectAxisUnit(axes: List[NgffAxis], axisOrder: AxisOrder): Fox[LengthUnit] =
    for {
      xUnit <- axes(axisOrder.x).lengthUnit.toFox
      yUnit <- axes(axisOrder.y).lengthUnit.toFox
      zUnitOpt <- Fox.runIf(axisOrder.hasZAxis)(axes(axisOrder.zWithFallback).lengthUnit)
      units: List[LengthUnit] = List(Some(xUnit), Some(yUnit), zUnitOpt).flatten
    } yield units.minBy(LengthUnit.toNanometer)

  private def extractAxisUnitFactors(unifiedAxisUnit: LengthUnit,
                                     axes: List[NgffAxis],
                                     axisOrder: AxisOrder): Fox[Vec3Double] =
    for {
      xUnitToNm <- axes(axisOrder.x).lengthUnit.map(LengthUnit.toNanometer).toFox
      yUnitToNm <- axes(axisOrder.y).lengthUnit.map(LengthUnit.toNanometer).toFox
      zUnitToNmOpt <- Fox.runIf(axisOrder.hasZAxis)(
        axes(axisOrder.zWithFallback).lengthUnit.map(LengthUnit.toNanometer))
      xUnitToTarget = xUnitToNm / LengthUnit.toNanometer(unifiedAxisUnit)
      yUnitToTarget = yUnitToNm / LengthUnit.toNanometer(unifiedAxisUnit)
      zUnitToTargetOpt = zUnitToNmOpt.map(_ / LengthUnit.toNanometer(unifiedAxisUnit))
    } yield Vec3Double(xUnitToTarget, yUnitToTarget, zUnitToTargetOpt.getOrElse(1))

  private def magFromTransforms(coordinateTransforms: List[NgffCoordinateTransformation],
                                voxelSizeInAxisUnits: Vec3Double,
                                axisOrder: AxisOrder): Fox[Vec3Int] = {
    def isPowerOfTwo(x: Int): Boolean =
      x != 0 && (x & (x - 1)) == 0

    val combinedScale = extractAndCombineScaleTransforms(coordinateTransforms, axisOrder)
    val mag = (combinedScale / voxelSizeInAxisUnits).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.y) && isPowerOfTwo(mag.z)) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag
  }

  /*
   * Guesses the voxel size from all transforms of an ngff multiscale object.
   * Note: the returned voxel size is in axis units and should later be combined with those units
   *   to get a webknossos-typical voxel size in nanometers.
   * Note: allCoordinateTransforms is nested: the inner list has all transforms of one ngff “dataset” (mag in our terminology),
   *   the outer list gathers these for all such “datasets” (mags) of one “multiscale object” (layer)
   */
  private def extractVoxelSizeInAxisUnits(allCoordinateTransforms: List[List[NgffCoordinateTransformation]],
                                          axisOrder: AxisOrder): Fox[Vec3Double] = {
    val scales = allCoordinateTransforms.map(t => extractAndCombineScaleTransforms(t, axisOrder))
    val smallestScaleIsUniform = scales.minBy(_.x) == scales.minBy(_.y) && scales.minBy(_.y) == scales.minBy(_.z)
    for {
      _ <- bool2Fox(smallestScaleIsUniform) ?~> "ngff scales do not agree on smallest dimension"
      voxelSizeInAxisUnits = scales.minBy(_.x)
    } yield voxelSizeInAxisUnits
  }

  private def extractAndCombineScaleTransforms(coordinateTransforms: List[NgffCoordinateTransformation],
                                               axisOrder: AxisOrder): Vec3Double = {
    val filtered = coordinateTransforms.filter(_.`type` == "scale")
    val scalesFromTransforms = filtered.flatMap(_.scale)
    val xFactors = scalesFromTransforms.map(_(axisOrder.x))
    val yFactors = scalesFromTransforms.map(_(axisOrder.y))
    val zFactors = if (axisOrder.hasZAxis) scalesFromTransforms.map(_(axisOrder.zWithFallback)) else Seq(1.0, 1.0)
    Vec3Double(xFactors.product, yFactors.product, zFactors.product)
  }
}
