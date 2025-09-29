package com.scalableminds.webknossos.datastore.services

import com.scalableminds.util.tools.{Box, Full, ParamFailure}
import com.scalableminds.webknossos.datastore.models.datasource.{ElementClass, UsableDataSource}
import play.api.libs.json.Json

trait DataSourceValidation {

  protected def assertValidDataSource(dataSource: UsableDataSource): Box[Unit] = {
    val errors = validateDataSourceGetErrors(dataSource)
    if (errors.isEmpty) {
      Full(())
    } else {
      ParamFailure("DataSource is invalid", Json.toJson(errors.map(e => Json.obj("error" -> e))))
    }
  }

  protected def validateDataSourceGetErrors(dataSource: UsableDataSource): Seq[String] = {
    def check(expression: Boolean, msg: String): Option[String] = if (!expression) Some(msg) else None

    // Check that when mags are sorted by max dimension, all dimensions are sorted.
    // This means each dimension increases monotonically.
    val magsSorted = dataSource.dataLayers.map(_.resolutions.sortBy(_.maxDim))
    val magsXIsSorted = magsSorted.map(_.map(_.x)) == magsSorted.map(_.map(_.x).sorted)
    val magsYIsSorted = magsSorted.map(_.map(_.y)) == magsSorted.map(_.map(_.y).sorted)
    val magsZIsSorted = magsSorted.map(_.map(_.z)) == magsSorted.map(_.map(_.z).sorted)

    val errors = List(
      check(dataSource.scale.factor.isStrictlyPositive, "Voxel size (scale) is negative in at least one dimension."),
      check(magsXIsSorted && magsYIsSorted && magsZIsSorted, "Mags do not monotonically increase in all dimensions."),
      check(magsSorted.forall(magsOfLayer => magsOfLayer.length == magsOfLayer.distinct.length),
            "There are duplicate mags in a layer."),
      check(dataSource.dataLayers.nonEmpty, "No layers."),
      check(dataSource.dataLayers.forall(!_.boundingBox.isEmpty), "Empty bounding box in a layer."),
      check(
        dataSource.segmentationLayers.forall { layer =>
          ElementClass.segmentationElementClasses.contains(layer.elementClass)
        },
        s"Invalid element class for a segmentation layer."
      ),
      check(
        dataSource.segmentationLayers.forall { layer =>
          ElementClass.largestSegmentIdIsInRange(layer.largestSegmentId, layer.elementClass)
        },
        "Largest segment id exceeds range (must be nonnegative, within element class range, and < 2^53)."
      ),
      check(
        dataSource.dataLayers.map(_.name).distinct.length == dataSource.dataLayers.length,
        "Layer names must be unique. At least two layers have the same name."
      ),
      check(
        dataSource.dataLayers.map(_.name).forall(!_.contains("/")),
        "Layer names must not contain forward slash."
      ),
      check(
        dataSource.dataLayers.map(_.name).forall(!_.startsWith(".")),
        "Layer names must not start with dot."
      ),
      check(
        dataSource.dataLayers.flatMap(_.attachments).forall(!_.containsDuplicateNames),
        "Layer attachments must have unique names in their respective category."
      )
    ).flatten

    errors
  }

}
