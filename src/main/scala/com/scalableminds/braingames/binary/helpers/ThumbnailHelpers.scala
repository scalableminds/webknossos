package com.scalableminds.braingames.binary.helpers

import com.scalableminds.braingames.binary.models.VoxelPosition
import com.scalableminds.braingames.binary.models.datasource.DataLayerLike

object ThumbnailHelpers {

  def bestResolution(dataLayer: DataLayerLike, width: Int, height: Int): Int = {
    // We want to make sure that the thumbnail only contains data, as much as possible but no black border
    // To make sure there is no black border we are going to go with the second best resolution (hence the `- 1`)
    val wr = math.floor(math.log(dataLayer.boundingBox.width.toDouble / width) / math.log(2)).toInt - 1
    val hr = math.floor(math.log(dataLayer.boundingBox.height.toDouble / height) / math.log(2)).toInt - 1

    val resolutionExponent = math.max(0, List(wr, hr, dataLayer.resolutions.size - 1).min)
    math.pow(2, resolutionExponent).toInt
  }

  def goodThumbnailParameters(dataLayer: DataLayerLike, width: Int, height: Int): VoxelPosition = {
    // Parameters that seem to be working good enough
    val center = dataLayer.boundingBox.center
    val resolution = bestResolution(dataLayer, width, height)
    val x = center.x - width * resolution / 2
    val y = center.y - height * resolution / 2
    val z = center.z
    new VoxelPosition(x.toInt, y.toInt, z.toInt, resolution)
  }
}
