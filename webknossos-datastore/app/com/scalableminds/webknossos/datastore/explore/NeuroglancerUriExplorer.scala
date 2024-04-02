package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.geometry.{Vec3Double, Vec3Int}
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerWithMagLocators, LayerViewConfiguration}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
import play.api.libs.json._

import java.net.URI
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class NeuroglancerUriExplorer @Inject()(dataVaultService: DataVaultService,
                                        exploreLayerService: ExploreLayerService,
                                        implicit val ec: ExecutionContext)
    extends RemoteLayerExplorer {
  override def name: String = "Neuroglancer URI Explorer"

  override def explore(remotePath: VaultPath,
                       credentialId: Option[String]): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    for {
      _ <- Fox.successful(())
      uriFragment <- tryo(remotePath.toUri.getFragment.drop(1)) ?~> "URI has no matching fragment part"
      spec <- Json.parse(uriFragment).validate[JsObject].toFox ?~> "Did not find JSON object in URI"
      layerSpecs <- (spec \ "layers").validate[JsArray].toFox
      _ <- Fox.bool2Fox(credentialId.isEmpty) ~> "Neuroglancer URI Explorer does not support credentials"
      exploredLayers = layerSpecs.value.map(exploreNeuroglancerLayer).toList
      layerLists <- Fox.combined(exploredLayers)
      layers = layerLists.flatten
      renamedLayers = exploreLayerService.makeLayerNamesUnique(layers.map(_._1))
    } yield renamedLayers.zip(layers.map(_._2))

  private def exploreNeuroglancerLayer(layerSpec: JsValue): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    for {
      _ <- Fox.successful(())
      obj <- layerSpec.validate[JsObject].toFox
      source <- (obj \ "source").validate[JsString].toFox
      layerType = new URI(source.value).getScheme
      sourceURI = new URI(source.value.substring(f"$layerType://".length))
      name <- (obj \ "name").validate[JsString].toFox
      remoteSourceDescriptor = RemoteSourceDescriptor(sourceURI, None)
      remotePath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
      viewConfiguration = getViewConfig(obj)
      layer <- exploreLayer(layerType, remotePath, name.value)
      layerWithViewConfiguration <- assignViewConfiguration(layer, viewConfiguration)
    } yield layerWithViewConfiguration

  private def exploreLayer(layerType: String,
                           remotePath: VaultPath,
                           name: String): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    layerType match {
      case "n5" =>
        Fox.firstSuccess(
          Seq(new N5ArrayExplorer().explore(remotePath, None), new N5MultiscalesExplorer().explore(remotePath, None)))
      case "precomputed" => new PrecomputedExplorer().explore(remotePath, None)
      case "zarr" | "zarr2" =>
        Fox.firstSuccess(
          Seq(new NgffExplorer().explore(remotePath, None),
              new ZarrArrayExplorer(Vec3Int.ones, ec).explore(remotePath, None)))
      case "zarr3" => new Zarr3ArrayExplorer().explore(remotePath, None)
      case _       => Fox.failure(f"Can not explore layer of $layerType type")
    }

  private def getViewConfig(layerSpec: JsObject): LayerViewConfiguration = {
    val opacity = (layerSpec \ "opacity").validate[Double].getOrElse(1.0)
    val intensityRange = (layerSpec \ "shaderControls" \ "normalized" \ "range").validate[JsArray].asOpt
    val options = Seq("alpha" -> JsNumber(opacity * 100)) ++ intensityRange.map("intensityRange" -> _)
    options.toMap
  }

  private def assignViewConfiguration(
      value: List[(DataLayerWithMagLocators, Vec3Double)],
      configuration: LayerViewConfiguration.LayerViewConfiguration): Fox[List[(DataLayerWithMagLocators, Vec3Double)]] =
    for {
      _ <- Fox.successful(())
      layers = value.map(_._1)
      layersWithViewConfigs = layers.map(l => l.mapped(defaultViewConfigurationMapping = _ => Some(configuration)))
    } yield layersWithViewConfigs.zip(value.map(_._2))

}
