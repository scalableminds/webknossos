package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.image.Color
import com.scalableminds.util.tools.TextUtils.normalizeStrong
import com.scalableminds.util.tools.{Fox, FoxImplicits, TextUtils}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datareaders.zarr.{
  NgffAxis,
  NgffChannelWindow,
  NgffCoordinateTransformation,
  NgffDataset,
  NgffLabelsGroup,
  NgffMultiscalesItem,
  NgffMultiscalesItemV0_5,
  NgffOmeroMetadata
}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.{LengthUnit, VoxelSize}
import com.scalableminds.webknossos.datastore.models.LengthUnit.LengthUnit
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{
  AdditionalAxis,
  CoordinateTransformation,
  CoordinateTransformationType,
  DataLayerWithMagLocators,
  ElementClass,
  LayerViewConfiguration
}
import com.scalableminds.util.tools.Box
import play.api.libs.json.{JsArray, JsBoolean, JsNumber, Json}

import scala.concurrent.ExecutionContext

trait NgffExplorationUtils extends FoxImplicits {

  protected case class ChannelAttributes(color: Option[Color],
                                         name: Option[String],
                                         window: Option[NgffChannelWindow],
                                         inverted: Option[Boolean],
                                         active: Option[Boolean])

  protected def getChannelAttributes(
      ngffOmeroMetadata: Option[NgffOmeroMetadata]
  ): Option[Seq[ChannelAttributes]] =
    ngffOmeroMetadata match {
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

  protected def parseChannelAttributes(channelAttributes: Option[Seq[ChannelAttributes]],
                                       datasetName: String,
                                       channelIndex: Int): (LayerViewConfiguration, String) =
    channelAttributes match {
      case Some(attributes) => {
        val thisChannelAttributes = attributes(channelIndex)
        val attributeName: String =
          thisChannelAttributes.name
            .map(TextUtils.normalizeStrong(_).getOrElse(datasetName).replaceAll(" ", ""))
            .getOrElse(datasetName)

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
      case None => (LayerViewConfiguration.empty, datasetName)
    }

  protected def extractAxisOrder(axes: List[NgffAxis])(implicit ec: ExecutionContext): Fox[AxisOrder] = {
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

  protected def selectAxisUnit(axes: List[NgffAxis], axisOrder: AxisOrder)(
      implicit ec: ExecutionContext): Fox[LengthUnit] =
    for {
      xUnit <- axes(axisOrder.x).lengthUnit.toFox
      yUnit <- axes(axisOrder.y).lengthUnit.toFox
      zUnitOpt <- Fox.runIf(axisOrder.hasZAxis)(axes(axisOrder.zWithFallback).lengthUnit)
      units: List[LengthUnit] = List(Some(xUnit), Some(yUnit), zUnitOpt).flatten
    } yield units.minBy(LengthUnit.toNanometer)

  protected def extractAxisUnitFactors(unifiedAxisUnit: LengthUnit, axes: List[NgffAxis], axisOrder: AxisOrder)(
      implicit ec: ExecutionContext): Fox[Vec3Double] =
    for {
      xUnitToNm <- axes(axisOrder.x).lengthUnit.map(LengthUnit.toNanometer).toFox
      yUnitToNm <- axes(axisOrder.y).lengthUnit.map(LengthUnit.toNanometer).toFox
      zUnitToNmOpt <- Fox.runIf(axisOrder.hasZAxis)(
        axes(axisOrder.zWithFallback).lengthUnit.map(LengthUnit.toNanometer))
      xUnitToTarget = xUnitToNm / LengthUnit.toNanometer(unifiedAxisUnit)
      yUnitToTarget = yUnitToNm / LengthUnit.toNanometer(unifiedAxisUnit)
      zUnitToTargetOpt = zUnitToNmOpt.map(_ / LengthUnit.toNanometer(unifiedAxisUnit))
    } yield Vec3Double(xUnitToTarget, yUnitToTarget, zUnitToTargetOpt.getOrElse(1))

  protected def magFromTransforms(coordinateTransforms: List[NgffCoordinateTransformation],
                                  voxelSizeInAxisUnits: Vec3Double,
                                  axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[Vec3Int] = {
    def isPowerOfTwo(x: Int): Boolean =
      x != 0 && (x & (x - 1)) == 0

    val combinedScale = extractAndCombineScaleTransforms(coordinateTransforms, axisOrder)
    val mag = (combinedScale / voxelSizeInAxisUnits).round.toVec3Int
    for {
      _ <- bool2Fox(isPowerOfTwo(mag.x) && isPowerOfTwo(mag.y) && isPowerOfTwo(mag.z)) ?~> s"invalid mag: $mag. Must all be powers of two"
    } yield mag
  }

  protected def ensureElementClassForSegmentationLayer(e: ElementClass.Value): ElementClass.Value =
    e match {
      case ElementClass.int8  => ElementClass.uint8
      case ElementClass.int16 => ElementClass.uint16
      case ElementClass.int32 => ElementClass.uint32
      case ElementClass.int64 => ElementClass.uint64
      case _                  => e
    }

  /**
    * Guesses the voxel size from all transforms of an ngff multiscale object.
    * Note: the returned voxel size is in axis units and should later be combined with those units
    *   to get a webknossos-typical voxel size in nanometers.
    * Note: allCoordinateTransforms is nested: the inner list has all transforms of one ngff “dataset” (mag in our terminology),
    *   the outer list gathers these for all such “datasets” (mags) of one “multiscale object” (layer)
    */
  protected def extractVoxelSizeInAxisUnits(allCoordinateTransforms: List[List[NgffCoordinateTransformation]],
                                            axisOrder: AxisOrder)(implicit ec: ExecutionContext): Fox[Vec3Double] = {
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

  protected def getShape(dataset: NgffDataset, path: VaultPath): Fox[Array[Int]]

  protected def createAdditionalAxis(name: String, index: Int, bounds: Array[Int]): Box[AdditionalAxis] =
    for {
      normalizedName <- Box(normalizeStrong(name)) ?~ s"Axis name '$name' would be empty if sanitized"
      _ <- Option(bounds.length == 2).collect { case true => () }
    } yield AdditionalAxis(normalizedName, bounds, index)

  protected def getAdditionalAxes(multiscale: NgffMultiscalesItem, remotePath: VaultPath)(
      implicit ec: ExecutionContext): Fox[Seq[AdditionalAxis]] = {
    val defaultAxes = List("c", "x", "y", "z")
    for {
      // Selecting shape of first mag, assuming no mags for additional coordinates
      dataset <- Fox.option2Fox(multiscale.datasets.headOption)
      shape <- getShape(dataset, remotePath)
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

  protected def getNgffMultiscaleChannelCount(multiscale: NgffMultiscalesItem, remotePath: VaultPath)(
      implicit ec: ExecutionContext): Fox[Int] =
    for {
      firstDataset <- multiscale.datasets.headOption.toFox
      shape <- getShape(firstDataset, remotePath)
      axisOrder <- extractAxisOrder(multiscale.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      channelCount = axisOrder.c match {
        case Some(channeAxislIndex) => shape(channeAxislIndex)
        case _                      => 1
      }
    } yield channelCount

  protected def createLayer(remotePath: VaultPath,
                            credentialId: Option[String],
                            multiscale: NgffMultiscalesItem,
                            channelIndex: Int,
                            channelAttributes: Option[Seq[ChannelAttributes]],
                            datasetName: String,
                            voxelSizeInAxisUnits: Vec3Double,
                            axisOrder: AxisOrder,
                            isSegmentation: Boolean): Fox[DataLayerWithMagLocators]

  protected def layersFromNgffMultiscale(multiscale: NgffMultiscalesItem,
                                         remotePath: VaultPath,
                                         credentialId: Option[String],
                                         channelCount: Int,
                                         channelAttributes: Option[Seq[ChannelAttributes]] = None,
                                         isSegmentation: Boolean = false)(
      implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      axisOrder <- extractAxisOrder(multiscale.axes) ?~> "Could not extract XYZ axis order mapping. Does the data have x, y and z axes, stated in multiscales metadata?"
      unifiedAxisUnit <- selectAxisUnit(multiscale.axes, axisOrder)
      axisUnitFactors <- extractAxisUnitFactors(unifiedAxisUnit, multiscale.axes, axisOrder) ?~> "Could not extract axis unit-to-nm factors"
      voxelSizeInAxisUnits <- extractVoxelSizeInAxisUnits(
        multiscale.datasets.map(_.coordinateTransformations),
        axisOrder) ?~> "Could not extract voxel size from scale transforms"
      voxelSizeFactor = voxelSizeInAxisUnits * axisUnitFactors
      nameFromPath = remotePath.basename
      datasetName = multiscale.name.flatMap(TextUtils.normalizeStrong).getOrElse(nameFromPath)
      layers <- Fox.serialCombined((0 until channelCount).toList)({ (channelIndex: Int) =>
        createLayer(remotePath,
                    credentialId,
                    multiscale,
                    channelIndex,
                    channelAttributes,
                    datasetName,
                    voxelSizeInAxisUnits,
                    axisOrder,
                    isSegmentation)
      })
      layerAndVoxelSizeTuples = layers.map((_, VoxelSize(voxelSizeFactor, unifiedAxisUnit)))
    } yield layerAndVoxelSizeTuples

  protected def getTranslation(multiscale: NgffMultiscalesItem): Option[List[CoordinateTransformation]] = {
    val is2d = !multiscale.axes.exists(_.name == "z")
    val baseTranslation = if (is2d) List(1.0, 1.0) else List(1.0, 1.0, 1.0)
    multiscale.datasets.headOption match {
      case Some(firstDataset) if firstDataset.coordinateTransformations.exists(_.`type` == "translation") => {
        var translation = firstDataset.coordinateTransformations.foldLeft(baseTranslation)((acc, ct) => {
          ct.`type` match {
            case "translation" =>
              ct.translation match {
                case Some(translationList) =>
                  acc.zipWithIndex.map { case (v, i) => v * translationList(translationList.length - 1 - i) }
                case _ => acc
              }
            case _ =>
              ct.scale match {
                case Some(scaleList) => acc.zipWithIndex.map { case (v, i) => v / scaleList(scaleList.length - 1 - i) }
                case _               => acc
              }
          }
        })
        if (is2d) {
          translation = translation :+ 0.0
        }
        val xTranslation = translation(0)
        val yTranslation = translation(1)
        val zTranslation = translation(2)
        val coordinateTransformation = CoordinateTransformation(
          `type` = CoordinateTransformationType.affine,
          matrix = Some(
            List(List(1, 0, 0, xTranslation),
                 List(0, 1, 0, yTranslation),
                 List(0, 0, 1, zTranslation),
                 List(0, 0, 0, 1)))
        )
        Some(List(coordinateTransformation))
      }
      case _ => None
    }
  }

  protected def layersForLabel(remotePath: VaultPath,
                               labelPath: String,
                               credentialId: Option[String]): Fox[List[(DataLayerWithMagLocators, VoxelSize)]]

  protected def exploreLabelLayers(remotePath: VaultPath, credentialId: Option[String])(
      implicit ec: ExecutionContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      labelDescriptionPath <- Fox.successful(remotePath / NgffLabelsGroup.LABEL_PATH)
      labelGroup <- labelDescriptionPath.parseAsJson[NgffLabelsGroup]
      layerTuples <- Fox.serialCombined(labelGroup.labels) { labelPath =>
        layersForLabel(remotePath, labelPath, credentialId)
      }
    } yield layerTuples.flatten

  implicit def multiScalesV0_5ToV0_4(multiscalesItemV0_5: NgffMultiscalesItemV0_5): NgffMultiscalesItem =
    NgffMultiscalesItemV0_5.asV0_4(multiscalesItemV0_5)
}
