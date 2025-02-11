package models.job

import com.scalableminds.util.enumeration.ExtendedEnumeration

object JobCommand extends ExtendedEnumeration {
  type JobCommand = Value

  /* NOTE: When adding a new job command here, do
   * - Decide if it should be a highPriority job
   * - Add it to the dbtool.js command enable-jobs so it is available during development
   * - Add it to the migration guide (operators need to decide which workers should provide it)
   */

  val compute_mesh_file, compute_segment_index_file, convert_to_wkw, export_tiff, find_largest_segment_id,
      globalize_floodfills, infer_nuclei, infer_neurons, materialize_volume_annotation, render_animation,
      infer_mitochondria, align_sections, train_model, infer_with_model = Value

  val highPriorityJobs: Set[Value] = Set(convert_to_wkw, export_tiff)
  val lowPriorityJobs: Set[Value] = values.diff(highPriorityJobs)
}
