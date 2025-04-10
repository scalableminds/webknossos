package com.scalableminds.webknossos.datastore.explore

import com.scalableminds.util.accesscontext.TokenContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.datavault.VaultPath
import com.scalableminds.webknossos.datastore.models.VoxelSize
import com.scalableminds.webknossos.datastore.models.datasource.LayerViewConfiguration.LayerViewConfiguration
import com.scalableminds.webknossos.datastore.models.datasource.{DataLayerWithMagLocators, LayerViewConfiguration}
import com.scalableminds.webknossos.datastore.storage.{DataVaultService, RemoteSourceDescriptor}
import net.liftweb.common.Box.tryo
import play.api.libs.json._

import java.net.URI
import scala.concurrent.ExecutionContext

class NeuroglancerUriExplorer(dataVaultService: DataVaultService)(implicit val ec: ExecutionContext)
    extends RemoteLayerExplorer
    with FoxImplicits
    with ExploreLayerUtils {
  override def name: String = "Neuroglancer URI Explorer"

  override def explore(remotePath: VaultPath, credentialId: Option[String])(
      implicit tc: TokenContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      _ <- Fox.successful(())
      uriFragment <- tryo(remotePath.toUri.getFragment.drop(1)).toFox ?~> "URI has no matching fragment part"
      spec <- Json.parse(uriFragment).validate[JsObject].asOpt.toFox ?~> "Did not find JSON object in URI"
      layerSpecs <- (spec \ "layers").validate[JsArray].asOpt.toFox
      _ <- Fox.fromBool(credentialId.isEmpty) ~> "Neuroglancer URI Explorer does not support credentials"
      exploredLayers = layerSpecs.value.map(exploreNeuroglancerLayer).toList
      layerLists <- Fox.combined(exploredLayers)
      layers = layerLists.flatten
      renamedLayers = makeLayerNamesUnique(layers.map(_._1))
    } yield renamedLayers.zip(layers.map(_._2))

  private def exploreNeuroglancerLayer(layerSpec: JsValue)(
      implicit tc: TokenContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      _ <- Fox.successful(())
      obj <- layerSpec.validate[JsObject].asOpt.toFox
      source <- (obj \ "source").validate[JsString].asOpt.toFox
      layerType = new URI(source.value).getScheme
      sourceURI = new URI(source.value.substring(f"$layerType://".length))
      name <- (obj \ "name").validate[JsString].asOpt.toFox
      remoteSourceDescriptor = RemoteSourceDescriptor(sourceURI, None)
      remotePath <- dataVaultService.getVaultPath(remoteSourceDescriptor) ?~> "dataVault.setup.failed"
      viewConfiguration = getViewConfig(obj)
      layer <- exploreLayer(layerType, remotePath, name.value)
      layerWithViewConfiguration <- assignViewConfiguration(layer, viewConfiguration)
    } yield layerWithViewConfiguration

  private def exploreLayer(layerType: String, remotePath: VaultPath, name: String)(
      implicit tc: TokenContext): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    layerType match {
      case "n5" =>
        Fox.firstSuccess(
          Seq(
            new N5ArrayExplorer().explore(remotePath, None),
            new N5MultiscalesExplorer().explore(remotePath, None),
            new N5CompactMultiscalesExplorer().explore(remotePath, None)
          ))
      case "precomputed" => new PrecomputedExplorer().explore(remotePath, None)
      case "zarr" | "zarr2" =>
        Fox.firstSuccess(
          Seq(
            new NgffV0_4Explorer().explore(remotePath, None),
            new NgffV0_5Explorer().explore(remotePath, None),
            new ZarrArrayExplorer(Vec3Int.ones).explore(remotePath, None)
          ))
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
      value: List[(DataLayerWithMagLocators, VoxelSize)],
      configuration: LayerViewConfiguration.LayerViewConfiguration): Fox[List[(DataLayerWithMagLocators, VoxelSize)]] =
    for {
      _ <- Fox.successful(())
      layers = value.map(_._1)
      layersWithViewConfigs = layers.map(l => l.mapped(defaultViewConfigurationMapping = _ => Some(configuration)))
    } yield layersWithViewConfigs.zip(value.map(_._2))

}
