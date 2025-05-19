package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.Vec3Double
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.dataformats.layers.{N5DataLayer, N5Layer, N5SegmentationLayer}
import com.scalableminds.webknossos.datastore.datareaders.AxisOrder
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.Category
import net.liftweb.common.Box.tryo

import scala.concurrent.ExecutionContext

trait N5Explorer extends RemoteLayerExplorer {

  implicit def ec: ExecutionContext

  protected def extractAxisUnitFactors(unitsOpt: Option[List[String]], axisOrder: AxisOrder): Fox[Vec3Double] =
    unitsOpt match {
      case Some(units) =>
        for {
          xUnitFactor <- spaceUnitToNmFactor(units(axisOrder.x))
          yUnitFactor <- spaceUnitToNmFactor(units(axisOrder.yWithFallback))
          zUnitFactor <- spaceUnitToNmFactor(units(axisOrder.zWithFallback))
        } yield Vec3Double(xUnitFactor, yUnitFactor, zUnitFactor)
      case None => Fox.successful(Vec3Double(1e3, 1e3, 1e3)) // assume default micrometers
    }

  private def spaceUnitToNmFactor(unit: String): Fox[Double] =
    unit.toLowerCase match {
      case "ym"        => Fox.successful(1e-15)
      case "zm"        => Fox.successful(1e-12)
      case "am"        => Fox.successful(1e-9)
      case "fm"        => Fox.successful(1e-6)
      case "pm"        => Fox.successful(1e-3)
      case "nm"        => Fox.successful(1.0)
      case "µm"        => Fox.successful(1e3)
      case "um"        => Fox.successful(1e3)
      case "mm"        => Fox.successful(1e6)
      case "cm"        => Fox.successful(1e7)
      case "dm"        => Fox.successful(1e8)
      case "m"         => Fox.successful(1e9)
      case ""          => Fox.successful(1e3) // default is micrometers
      case unknownUnit => Fox.failure(s"Unknown space axis unit: $unknownUnit")
    }

  protected def extractAxisOrder(axes: List[String]): Fox[AxisOrder] = {
    val x = axes.indexWhere(_ == "x")
    val y = axes.indexWhere(_ == "y")
    val z = axes.indexWhere(_ == "z")
    val c = axes.indexWhere(_ == "c")

    val cOpt = if (c == -1) None else Some(c)
    for {
      _ <- Fox.fromBool(x >= 0 && y >= 0 && z >= 0) ?~> s"invalid xyz axis order: $x,$y,$z."
    } yield AxisOrder(x, Some(y), Some(z), cOpt)
  }

  protected def extractVoxelSizeInAxisUnits(scale: List[Double], axisOrder: AxisOrder): Fox[Vec3Double] =
    tryo(Vec3Double(scale(axisOrder.x), scale(axisOrder.yWithFallback), scale(axisOrder.zWithFallback))).toFox

  protected def layerFromMagsWithAttributes(magsWithAttributes: List[MagWithAttributes],
                                            remotePath: VaultPath): Fox[N5Layer] =
    for {
      _ <- Fox.fromBool(magsWithAttributes.nonEmpty) ?~> "zero mags in layer"
      elementClass <- elementClassFromMags(magsWithAttributes) ?~> "Could not extract element class from mags"
      boundingBox = boundingBoxFromMags(magsWithAttributes)
      name = guessNameFromPath(remotePath)
      layer: N5Layer = if (looksLikeSegmentationLayer(name, elementClass)) {
        N5SegmentationLayer(name, boundingBox, elementClass, magsWithAttributes.map(_.mag), largestSegmentId = None)
      } else N5DataLayer(name, Category.color, boundingBox, elementClass, magsWithAttributes.map(_.mag))
    } yield layer
}
