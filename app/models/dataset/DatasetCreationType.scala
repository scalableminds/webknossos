package models.dataset

import com.scalableminds.util.enumeration.ExtendedEnumeration

object DatasetCreationType extends ExtendedEnumeration {
  type DatasetCreationType = Value
  val Upload, DiskScan, UploadToPaths, ExploreAndAdd, Compose = Value
}
