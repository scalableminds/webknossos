/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.braingames.binary.repository

import com.scalableminds.braingames.binary.requester.DataRequester
import com.scalableminds.braingames.binary.models._
import com.scalableminds.util.tools.ProgressTracking.ProgressTracker
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.geometry.BoundingBox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.Box
import java.nio.file.Path
import scala.concurrent.ExecutionContext.Implicits._
import play.api.i18n.{I18nSupport, Messages, MessagesApi}

class WebKnossosWrapDataSourceType(val messagesApi: MessagesApi) extends DataSourceType
  with DataSourceTypeHandler
  with I18nSupport
  with FoxImplicits
  with LazyLogging {

  val name = "webKnossosWrap"

  private val maxRecursiveLayerDepth = 2

  private val DEFAULT_PRIORITY = 0

  def fileExtension = "wkw"

  def importDataSource(dataRequester: DataRequester, unusableDataSource: UnusableDataSource, progressTracker: ProgressTracker)
                      (implicit messages: Messages): Fox[DataSource] = {
    val path = unusableDataSource.sourceFolder
    val wkwDataSource = new WebKnossosWrapDataSource(path)(messages)

    for {
      settings <- wkwDataSource.settings.toFox ?~> "Couldn't parse settings file."
      layers <- extractLayers(path, settings.layers) ?~> "Could not extract layers."
    } yield {
      DataSource(
        settings.name getOrElse path.getFileName.toString,
        path.toAbsolutePath.toString,
        settings.scale,
        settings.priority.getOrElse(DEFAULT_PRIORITY),
        layers,
        Some(name),
        Some(32))
    }
  }

  protected def extractLayers(basePath: Path, layersSettings: List[WebKnossosWrapDataLayerSettings]): Fox[List[DataLayer]] = {
    Fox.combined(layersSettings.map(extractLayer(basePath, _).toFox))
  }

  protected def extractLayer(basePath: Path, layerSettings: WebKnossosWrapDataLayerSettings): Box[DataLayer] = {
    for {
      boundingBox <- BoundingBox.createFrom(layerSettings.boundingBox) ?~! Messages("dataset.layer.bbox.invalid")
    } yield {
      DataLayer(
        layerSettings.name,
        layerSettings.typ,
        basePath.resolve(layerSettings.name).toString,
        None,
        layerSettings.`class`,
        false,
        None,
        None,
        List(DataLayerSection(
          basePath.resolve(layerSettings.name).toString,
          "",
          layerSettings.resolutions,
          boundingBox,
          boundingBox
        )),
        None,
        List(),
        Some(name)
      )
    }
  }
}
