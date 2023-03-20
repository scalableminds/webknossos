package models.job

import com.scalableminds.util.enumeration.ExtendedEnumeration

object JobCommand extends ExtendedEnumeration {
  type JobCommand = Value

  val COMPUTE_MESH_FILE = Value("compute_mesh_file")
  val CONVERT_TO_WKW = Value("convert_to_wkw")
  val EXPORT_TIFF = Value("export_tiff")
  val FIND_LARGEST_SEGMENT_ID = Value("find_largest_segment_id")
  val GLOBALIZE_FLOODFILLS = Value("globalize_floodfills")
  val INFER_NUCLEI = Value("infer_nuclei")
  val INFER_NEURONS = Value("infer_neurons")
  val MATERIALIZE_VOLUME_ANNOTATION = Value("materialize_volume_annotation")
}
