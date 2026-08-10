package models.job

import com.scalableminds.util.enumeration.ExtendedEnumeration

object JobCommand extends ExtendedEnumeration {
  type JobCommand = Value

  /* NOTE: When adding a new job command here, do
   * - Decide if it should be a highPriority job
   * - Decide if it writes to the organization’s storage (see jobsWritingToStorage)
   * - Add it to the dbtool.js command enable-jobs so it is available during development
   * - Add it to the migration guide (operators need to decide which workers should provide it)
   */

  val compute_mesh_file, compute_segment_index_file, convert_to_wkw, export_tiff, find_largest_segment_id,
      materialize_volume_annotation, render_animation, align_sections, infer_neurons, infer_instances,
      infer_mitochondria, train_neuron_model, train_instance_model,
  // No-longer supported jobs, kept here to be able to display old existing jobs:
  globalize_floodfills, train_model, infer_with_model, infer_nuclei = Value

  val highPriorityJobs: Set[Value] = Set(convert_to_wkw, export_tiff)
  val lowPriorityJobs: Set[Value] = values.diff(highPriorityJobs)

  /* Jobs that store their results in the organization’s WEBKNOSSOS storage (as new datasets or as
   * layer attachments). Starting them is refused while the organization’s storage quota is exceeded,
   * as their results could not be stored. Jobs that only write to the exports directory
   * (export_tiff, render_animation), report back a value (find_largest_segment_id) or store a model
   * (train_*) are not included. convert_to_wkw is not included either, since the storage quota is
   * already checked when reserving the upload it belongs to.
   */
  val jobsWritingToStorage: Set[Value] = Set(
    align_sections,
    compute_mesh_file,
    compute_segment_index_file,
    infer_instances,
    infer_mitochondria,
    infer_neurons,
    materialize_volume_annotation
  )
}
