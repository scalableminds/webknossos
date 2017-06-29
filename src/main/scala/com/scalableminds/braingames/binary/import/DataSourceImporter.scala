/*
 * Copyright (C) 2011-2017 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.`import`

import java.nio.file.Path

import com.scalableminds.braingames.binary.dataformats.MappingProvider
import com.scalableminds.braingames.binary.dataformats.knossos.KnossosSection
import com.scalableminds.braingames.binary.models.datasource._
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale}
import com.scalableminds.util.io.PathUtils
import net.liftweb.common.Box
import org.apache.commons.io.FilenameUtils
import com.scalableminds.util.tools.ExtendedTypes._

import scala.collection.mutable.ArrayBuffer

case class DataSourceImportReport[A](ctx: A, messages: ArrayBuffer[(String, String)] = ArrayBuffer.empty) {

  def error(msg: A => String) = messages.append("error" -> msg(ctx))

  def warning(msg: A => String) = messages.append("warning" -> msg(ctx))

  def info(msg: A => String) = messages.append("info" -> msg(ctx))

  def withContext(f: A => A) = DataSourceImportReport(f(ctx), messages)
}

trait DataSourceImporter {

  def dataFileExtension: String

  protected def exploreLayer(name: String, baseDir: Path, previous: Option[DataLayer])(implicit report: DataSourceImportReport[Path]): Box[DataLayer]

  def exploreDataSource(id: DataSourceId, baseDir: Path, previous: Option[DataSource], report: DataSourceImportReport[Path]): Box[DataSource] = {
    PathUtils.listDirectories(baseDir).map { layerDirs =>
      val layers = layerDirs.flatMap { layerDir =>
        val layerName = layerDir.getFileName.toString
        val previousLayer = None// TODO previous.flatMap(_.getDataLayer(layerName))
        exploreLayer(layerName, layerDir, previousLayer)(report.withContext(_.resolve(layerName)))
      }
      GenericDataSource(id, layers, previous.map(_.scale).getOrElse(Scale.default))
    }
  }

  protected def guessLayerCategory(layerName: String, elementClass: ElementClass.Value)(implicit report: DataSourceImportReport[Path]): Category.Value = {
    val ColorRx = ".*color.*".r
    val MaskRx = ".*mask.*".r
    val SegmentationRx = ".*segmentation.*".r

    layerName match {
      case ColorRx() =>
        Category.color
      // TODO enable as soon as client has mask support
      //case MaskRx() =>
      //  Category.mask
      case SegmentationRx() =>
        Category.segmentation
      case _ =>
        report.warning(layer => s"Layer [$layer] - Falling back to elementClass for determining category")
        Category.fromElementClass(elementClass)
    }
  }

  protected def exploreMappings(baseDir: Path): Set[String] = {
    PathUtils.listFiles(
      baseDir.resolve(MappingProvider.mappingsDir),
      PathUtils.fileExtensionFilter(MappingProvider.mappingFileExtension)).map {
      paths => paths.map(path => FilenameUtils.removeExtension(path.getFileName.toString))
    }.getOrElse(Nil).toSet
  }

  protected def exploreResolutions(baseDir: Path): Set[Int] = {
    def resolutionDirFilter(path: Path): Boolean = path.getFileName.toString.toIntOpt.isDefined
    PathUtils.listDirectories(baseDir, resolutionDirFilter).map{
      _.flatMap(_.getFileName.toString.toIntOpt)
    }.getOrElse(Nil).toSet
  }
}
