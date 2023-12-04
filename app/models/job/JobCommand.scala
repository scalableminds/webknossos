package models.job

import com.scalableminds.util.enumeration.ExtendedEnumeration

object JobCommand extends ExtendedEnumeration {
  type JobCommand = Value

  val compute_mesh_file, convert_to_wkw, export_tiff, find_largest_segment_id, globalize_floodfills, infer_nuclei,
  infer_neurons, materialize_volume_annotation, render_animation, compute_segment_index_file = Value
}
