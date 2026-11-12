package models.dataset

import com.scalableminds.util.enumeration.ExtendedEnumeration

object DatasetSortBy extends ExtendedEnumeration {
  type DatasetSortBy = Value
  val lastUsed, createdDesc, createdAsc, name, storage, annotationCount, searchRelevance = Value
}
