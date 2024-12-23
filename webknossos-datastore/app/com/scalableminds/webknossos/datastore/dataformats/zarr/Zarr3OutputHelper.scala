package com.scalableminds.webknossos.datastore.dataformats.zarr

import com.scalableminds.webknossos.datastore.models.datasource.AdditionalAxis

trait Zarr3OutputHelper {

  protected def reorderAdditionalAxes(additionalAxes: Seq[AdditionalAxis]): Seq[AdditionalAxis] = {
    val additionalAxesStartIndex = 1 // channel comes first
    val sorted = additionalAxes.sortBy(_.index)
    sorted.zipWithIndex.map {
      case (axis, index) => axis.copy(index = index + additionalAxesStartIndex)
    }
  }

}
