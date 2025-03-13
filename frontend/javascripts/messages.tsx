import _ from "lodash";
import type { Vector4 } from "oxalis/constants";
import type {
  DatasetConfiguration,
  DatasetLayerConfiguration,
  UserConfiguration,
} from "oxalis/store";

export type RecommendedConfiguration = Partial<
  UserConfiguration &
    DatasetConfiguration & {
      segmentationOpacity: number;
    }
>;

export const settings: Partial<Record<keyof RecommendedConfiguration, string>> = {
  clippingDistance: "Clipping Distance",
  displayCrosshair: "Show Crosshairs",
  displayScalebars: "Show Scalebars",
  dynamicSpaceDirection: "d/f-Switching",
  keyboardDelay: "Keyboard delay (ms)",
  moveValue: "Move Value (nm/s)",
  newNodeNewTree: "Single-node-tree mode (Soma clicking)",
  centerNewNode: "Auto-center Nodes",
  highlightCommentedNodes: "Highlight Commented Nodes",
  overrideNodeRadius: "Override Node Radius",
  particleSize: "Particle Size",
  tdViewDisplayPlanes: "Plane Display Mode in 3D View",
  tdViewDisplayDatasetBorders: "Display Dataset Borders in 3D View",
  tdViewDisplayLayerBorders: "Display Layer Borders in 3D View",
  fourBit: "4 Bit",
  interpolation: "Interpolation",
  segmentationOpacity: "Segmentation Opacity",
  zoom: "Zoom",
  renderMissingDataBlack: "Render Missing Data Black",
  clippingDistanceArbitrary: "Clipping Distance",
  mouseRotateValue: "Mouse Rotation",
  rotateValue: "Keyboard Rotation",
  sphericalCapRadius: "Sphere Radius",
  crosshairSize: "Crosshair Size",
  brushSize: "Brush Size",
  segmentationPatternOpacity: "Pattern Opacity",
  loadingStrategy: "Loading Strategy",
  gpuMemoryFactor: "Hardware Utilization",
  overwriteMode: "Volume Annotation Overwrite Mode",
  useLegacyBindings: "Classic Controls",
  blendMode: "Blend Mode",
  renderWatermark: "Logo in Screenshots",
  antialiasRendering: "Antialiasing",
  colorLayerOrder: "Color Layer Order",
};
export const settingsTooltips: Partial<Record<keyof RecommendedConfiguration, string>> = {
  loadingStrategy: `You can choose between loading the best quality first
      (will take longer until you see data) or alternatively,
      improving the quality progressively (data will be loaded faster,
      but it will take more time until the best quality is shown).`,
  fourBit:
    "Decrease size of transferred data by half, using lossy compression. Recommended for poor and/or capped internet connections.",
  interpolation: "Smooth the rendered data by interpolating color values.",
  renderMissingDataBlack:
    "If disabled, missing data will be rendered by using downsampled magnifications.",
  gpuMemoryFactor:
    "Controls which data magnification is displayed, depending on zoom value and viewport size. Adapt this setting to your hardware, so that rendering quality and performance are balanced. Medium is the default. Choosing a higher setting can result in poor performance. This setting also influences how much memory the graphics card will allocate.",
  useLegacyBindings:
    "When enabled, right-click does not open the context menu in some tools, but instead triggers actions, such as creating nodes or erasing volume data. This setting is only recommended when having experience with these classic mouse and keyboard bindings.",
  dynamicSpaceDirection:
    "When enabled, the move direction (shortcuts d/f) changes dynamically to match the direction of the last two created nodes.",
  keyboardDelay:
    "Delay after which shortcut keys (e.g. d/f for moving) are assumed to be intentionally held down, so that continuous movement is triggered.",
  moveValue: "Increase to speed up movement through the dataset when holding d/f/space.",
  displayCrosshair: "Show crosshair marker in the viewing direction center.",
  sphericalCapRadius: "Set the radius of the spherical cap the data is projected on.",
  crosshairSize: "Size of the crosshair marker in the viewing direction center.",
  rotateValue: "Rotation speed when using the arrow keys on the keyboard.",
  mouseRotateValue: "Rotation speed when using the mouse to drag the rotation.",
  zoom: "Zoom in or out in the data viewports.",
  displayScalebars: "Show a scale in the lower-right corner of each viewport.",
  blendMode:
    "Set the blend mode for the dataset. The additive mode (default) adds the data values of all color layers. In cover mode, color layers are rendered on top of each other so that the data values of lower color layers are hidden by values of higher layers. Cover mode enables reordering of color layers.",
  renderWatermark: "Show a WEBKNOSSOS logo in the lower-left corner of each screenshot.",
  antialiasRendering: "Antialias rendering (can impact performance)",
  colorLayerOrder:
    "Set the order in which color layers are rendered. This setting is only relevant if the cover blend mode is active.",
};
export const layerViewConfigurations: Partial<Record<keyof DatasetLayerConfiguration, string>> = {
  color: "Color",
  alpha: "Layer opacity",
  intensityRange: "Intensity Range",
  min: "Minimum Data Value",
  max: "Maximum Data Value",
  isDisabled: "Disabled Layer",
  isInverted: "Inverted Layer",
  isInEditMode: "Configuration Mode",
  gammaCorrectionValue: "Gamma Correction",
  mapping: "Active Mapping",
};
export const layerViewConfigurationTooltips: Partial<
  Record<keyof DatasetLayerConfiguration, string>
> = {
  gammaCorrectionValue:
    "Applies a non-linear mapping to the intensity values of this layer (the default is 1).",
};
export default {
  yes: "Yes",
  no: "No",
  unknown_error:
    "An unknown error occurred. Please try again or check the console for more details.",
  offline:
    "The communication to the server failed. This can happen when you are offline or when the server is down. Retrying...",
  "datastore.health": _.template(
    "The datastore server at <%- url %> does not seem to be available. Please check back in five minutes.",
  ),
  "datastore.version.too_new": _.template(
    "The datastore server at (<%- url %>) supplies a newer API version (<%- suppliedDatastoreApiVersion %>) than this WEBKNOSSOS expects (<%- expectedDatastoreApiVersion %>). Please contact your admins to upgrade this WEBKNOSSOS instance",
  ),
  "datastore.version.too_old": _.template(
    "The datastore server at (<%- url %>) supplies an older API version (<%- suppliedDatastoreApiVersion %>) than this WEBKNOSSOS expects (<%- expectedDatastoreApiVersion %>). Please contact the admins of the remote data store to upgrade.",
  ),
  "save.failed_simultaneous_tracing": `The annotation couldn't be saved because there was a conflict (annotation was edited either by someone else or in another browser tab).

A reload is necessary to return to a valid state.`,
  "react.rendering_error":
    "Unfortunately, WEBKNOSSOS encountered an error during rendering. Your latest changes may not have been saved. Please reload the page to try again.",
  "save.leave_page_unfinished":
    "WARNING: You have unsaved progress that may be lost when hitting OK. Please click cancel, wait until the progress is saved and the save button displays a checkmark before leaving the page..",
  "save.failed": "Failed to save annotation. Retrying.",
  "save.failed.permanent":
    "Failed to save annotation. Unfortunately, there might be a potential data loss. Please reload the page, check and correct the annotation.",
  "undo.no_undo":
    "There is no action that could be undone. However, if you want to restore an earlier version of this annotation, use the 'Restore Older Version' functionality in the dropdown next to the 'Save' button.",
  "undo.no_redo": "There is no action that could be redone.",
  "undo.no_undo_during_proofread":
    "Undo is not supported during proofreading yet. Please use the 'Restore Older Version' functionality in the dropdown next to the 'Save' button.",
  "undo.no_redo_during_proofread":
    "Redo is not supported during proofreading yet. Please use the 'Restore Older Version' functionality in the dropdown next to the 'Save' button.",
  "undo.import_volume_tracing":
    "Importing a volume annotation cannot be undone. However, if you want to restore an earlier version of this annotation, use the 'Restore Older Version' functionality in the dropdown next to the 'Save' button.",
  "download.wait": "Please wait...",
  "download.close_window": "You may close this window after the download has started.",
  "download.python_do_not_share": _.template(
    "These snippets are pre-configured and contain your personal access token and <%- typeName %> meta data. Do not share this information with anyone you do not trust!",
  ),
  "download.export_as_tiff": _.template(
    "Export this <%- typeName %> as TIFF image(s). This may take a few moments depending on the size of your configured export.",
  ),
  "add_script.confirm_change": "This will replace the code you have written. Continue?",
  "data.enabled_render_missing_data_black":
    "You just enabled the option to render missing data black. All layers will now be reloaded.",
  "data.disabled_render_missing_data_black": `You just disabled the option to render missing
data black. This means that in case of missing data, data of lower quality is rendered
instead. Only enable this option if you understand its effect. All layers will now be reloaded.`,
  "data.bounding_box_export_not_supported":
    "Exporting data is not supported for datasets on this datastore server.",
  "sampling.could_not_get_or_create_bucket": (zoomedAddress: Vector4) =>
    `While sampling could not get or create bucket at address ${zoomedAddress.toString()}.`,
  "tracing.unhandled_initialization_error":
    "Initialization error. Please refresh the page to retry. If the error persists, please contact an administrator.",
  "tracing.out_of_dataset_bounds":
    "The current position is outside of the dataset's bounding box. No data will be shown here.",
  "tracing.out_of_task_bounds": "The current position is outside of the task's bounding box.",
  "tracing.copy_position": "Copy position to clipboard",
  "tracing.copy_rotation": "Copy rotation to clipboard",
  "tracing.copy_sharing_link": "Copy sharing link to clipboard",
  "tracing.tree_length_notification": (treeName: string, lengthInNm: string, lengthInVx: string) =>
    `The tree ${treeName} has a total path length of ${lengthInNm} (${lengthInVx}).`,
  "tracing.sharing_modal_basic_information": (sharingActiveNode?: boolean) =>
    `This link includes the ${
      sharingActiveNode ? "active tree node," : ""
    } current position, zoom value and ID mapping. Consider fine-tuning your current view before copying the URL.`,
  "tracing.sharing_modal_zarr_information": (
    <span>
      This{" "}
      <a href="https://zarr.dev" target="_blank" rel="noreferrer">
        Zarr
      </a>{" "}
      link may be used by other tools to load the dataset&apos;s data in a streaming manner.
    </span>
  ),
  "tracing.copy_cell_id": "Hit CTRL + I to copy the currently hovered segment id",
  "tracing.segment_id_out_of_bounds": (
    requestedId: number,
    validRange: readonly [number, number],
  ) =>
    `Cannot create a segment with id=${requestedId} because it is not between ${validRange[0]} and ${validRange[1]}.`,

  "tracing.copy_maybe_mapped_cell_id":
    "Hit CTRL + I to copy the currently hovered segment id. Press CTRL + ALT + I if you want to copy the mapped id.",
  "tracing.no_more_branchpoints": "No more branchpoints",
  "tracing.branchpoint_set": "Branchpoint set",
  "tracing.branchpoint_jump_twice":
    "You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
  "tracing.edit_volume_in_merger_mode":
    "The volume annotation would be changed by this action. This is not allowed while merger mode is active.",
  "tracing.segmentation_zoom_warning":
    "Segmentation data and volume annotation is only fully supported at a smaller zoom level.",
  "tracing.uint64_segmentation_warning":
    "This is an unsigned 64-bit segmentation. The displayed ids are truncated to 53 bits. Thus, they might not match the ids on the server.",
  "tracing.segmentation_zoom_warning_agglomerate":
    "Segmentation data which is mapped using an agglomerate file cannot be rendered in this magnification. Please zoom in further.",
  "tracing.no_access": "You are not allowed to access this annotation.",
  "tracing.compound_project_not_found":
    "It looks like this project does not have a single task completed. Make sure that at least one task of this project is finished to view it.",
  "tracing.no_allowed_mode": "There was no valid allowed annotation mode specified.",
  "tracing.read_only_mode_notification": (isAnnotationLockedByUser: boolean, isOwner: boolean) =>
    isAnnotationLockedByUser
      ? `This annotation is in read-only mode and cannot be updated. It is currently locked by ${
          isOwner ? "you" : "the owner"
        }.`
      : "This annotation is in read-only mode and cannot be updated.",
  "tracing.volume_missing_segmentation": "Volume is allowed, but segmentation does not exist.",
  "tracing.volume_layer_name_duplication":
    "This layer name already exists! Please change it to resolve duplicates.",
  "tracing.volume_layer_name_includes_invalid_characters": (disallowedCharacters: string) =>
    `This layer name includes the disallowed character${
      disallowedCharacters.length > 1 ? "s" : ""
    } "${disallowedCharacters}". Please remove ${
      disallowedCharacters.length > 1 ? "them" : "it"
    } to set the layer name.`,
  "tracing.volume_layer_name_too_short": "The layer name must be at least one character long.",
  "tracing.volume_layer_name_starts_with_dot": "The layer name must not start with a dot.",
  "tracing.delete_initial_node": "Do you really want to delete the initial node?",
  "tracing.delete_tree": "Do you really want to delete the whole tree?",
  "tracing.delete_tree_with_initial_node":
    "The tree(s) you want to delete contain(s) the initial node. Do you really want to proceed with the deletion?",
  "tracing.delete_multiple_trees": _.template(
    "You have <%- countOfTrees %> trees selected, do you really want to delete all those trees?",
  ),
  "tracing.group_deletion_message": "Do you want to delete the selected group?",
  "tracing.merged": "Merging successfully done",
  "tracing.merged_with_redirect":
    "Merging successfully done. You will be redirected to the new annotation.",
  "tracing.tree_viewer_no_cyclic_trees":
    "Cyclic trees are not supported by the abstract tree viewer.",
  "tracing.changed_move_value": "The move value was changed to: ",
  "tracing.no_viewport_scaling_setting":
    "Scaling the viewports via k/l is not supported anymore. Instead you can increase the viewport size by dragging the borders between the panes. You can also rearrange the panes by dragging the tabs.",
  "tracing.natural_sorting": "Correctly sort numbers in text (word2 < word10). This may be slow!",
  "tracing.cant_create_node": "You cannot create nodes, since no tree is active.",
  "tracing.invalid_state":
    "A corruption in the current skeleton annotation was detected. Please contact your supervisor and/or the maintainers of WEBKNOSSOS to get help for restoring a working version. Please include as much details as possible about your past user interactions. This will be very helpful to investigate the source of this bug.",
  "tracing.merger_mode_node_outside_segment":
    "You cannot place nodes outside of a segment in merger mode.",
  "tracing.not_mesh_available_to_download":
    "There is no mesh for the active segment id available to download.",
  "tracing.mesh_listing_failed": (segmentId: number) =>
    `A precomputed mesh could not be loaded for segment ${segmentId}. You may want to use ad-hoc meshing instead. More information was printed to the browser's console.`,
  "tracing.area_to_fill_is_too_big":
    "The area you want to fill is too big. Please annotate the area in multiple strokes.",
  "tracing.agglomerate_skeleton.no_cell":
    "Clicked on the background. Please click on a segment to load a skeleton.",
  "tracing.agglomerate_skeleton.no_mapping":
    "Activate an agglomerate file mapping to load a skeleton for a segment.",
  "tracing.agglomerate_skeleton.no_agglomerate_file_active":
    "Loading a skeleton for a segment only works with agglomerate file mappings.",
  "tracing.agglomerate_skeleton.no_agglomerate_files_loaded_yet":
    "Checking for agglomerate files...",
  "tracing.agglomerate_skeleton.no_agglomerate_file_available":
    "No agglomerate file mapping is available for this segmentation layer. Please reach out to hello@webknossos.org to get help with generating one.",
  "tracing.agglomerate_skeleton.no_skeleton_tracing":
    "Loading a skeleton for a segment only works in skeleton or hybrid tracings.",
  "tracing.skeletons_are_hidden_warning":
    'All trees are currently hidden. You can disable this by toggling the "Skeleton" layer in the layer settings in the left sidebar.',
  "tracing.invalid_json_url_hash":
    "Cannot parse JSON URL hash. More information was printed to the browser's console.",
  "tracing.locked_mapping_info":
    "The active volume annotation layer has an active mapping. By mutating the layer, the mapping will be permanently locked and can no longer be changed or disabled. This can only be undone by restoring an older version of this annotation. Are you sure you want to continue?",
  "tracing.locked_mapping_confirmed": (mappingName: string) =>
    `The mapping ${mappingName} is now locked for this annotation and can no longer be changed or disabled.`,
  "mapping.loading_failed": (layerName: string) =>
    `Loading the available mappings for layer ${layerName} failed.`,
  "layouting.missing_custom_layout_info":
    "The annotation views are separated into four classes. Each of them has their own layouts. If you can't find your layout please open the annotation in the correct view mode or just add it here manually.",
  "datastore.unknown_type": "Unknown datastore type:",
  "webgl.disabled": "Couldn't initialise WebGL, please make sure WebGL is enabled.",
  "webgl.context_loss":
    "The WebGL context was lost. Please ensure that your graphics card driver is up to date to avoid such crashes. If this message keeps appearing, you can also try to lower the data rendering quality in the settings. Restarting your browser might also help.",
  "webgl.context_recovery":
    "The WebGL context has been recovered. If you experience unusual behavior, consider reloading the page.",
  "webgl.too_many_active_layers": _.template(
    "Your hardware cannot render all layers of this dataset simultaneously. Please ensure that not more than <%- maximumLayerCountToRender %> layers are enabled in the left sidebar settings.",
  ),
  "task.user_script_retrieval_error": "Unable to retrieve script",
  "task.new_description": "You are now annotating a new task with the following description",
  "task.no_description": "You are now annotating a new task with no description.",
  "task.delete": "Do you really want to delete this task?",
  "task.request_new": "Do you really want another task?",
  "task.peek_next": _.template(
    "The next task will most likely be part of project <%- projectName %>",
  ),
  "task.confirm_reset": "Do you really want to reset this task?",
  "task.domain_does_not_exist":
    "No matching experience domain. Assign this domain to a user to add it to the listed options.",
  "annotation.reset_success": "Annotation was successfully reset.",
  "annotation.disable_saving": "Are you sure you want to disable saving?",
  "annotation.disable_saving.content":
    "This can only be undone by refreshing the page. All unsaved changes will be lost. Only use this for large, temporary annotations to save resources.",
  "annotation.undoFinish.confirm": "Are you sure you want to reopen your old task?",
  "annotation.undoFinish.content":
    "If you reopen your old annotation, the current annotation will not be finished or cancelled. Instead, it will remain open and you can find it in the dashboard to continue annotating.",
  "annotation.acquiringMutexFailed": _.template(
    "This annotation is currently being edited by <%- userName %>. To avoid conflicts, you can only view it. If you want to edit it, please ask <%- userName %> to finish their work first.",
  ),
  "annotation.acquiringMutexFailed.noUser":
    "This annotation is currently being edited by someone else. To avoid conflicts, you can only view it at the moment.",
  "annotation.acquiringMutexSucceeded":
    "This annotation is not being edited anymore and available for editing. Reload the page to see its newest version and to edit it.",
  "annotation.unlock.success":
    "The annotation was successfully unlocked. Reloading this annotation ...",
  "annotation.lock.success":
    "The annotation was successfully locked. Reloading this annotation ...",
  "task.bulk_create_invalid":
    "Can not parse task specification. It includes at least one invalid task.",
  "task.recommended_configuration": "The author of this task suggests to use these settings:",
  "dataset.clear_cache_success": _.template(
    "The dataset <%- datasetName %> was reloaded successfully.",
  ),
  "dataset.delete_success": _.template(
    "The dataset <%- datasetName %> was successfully deleted on disk. Redirecting to dashboard...",
  ),
  "task.no_tasks_to_download": "There are no tasks available to download.",
  "task.tooltip_explain_reset":
    "Resets this task instance to its initial state, undoing any annotation work of the assigned user. The task will remain assigned to this user for further annotation work.",
  "task.tooltip_explain_reset_cancel":
    "Resets this task instance to its initial state, undoing any annotation work of the assigned user. Furthermore, the task assignment will be removed from the user’s account and recycled into the pool of available tasks for other users. The currently assigned user will not be assigned to this task again (unless they are an Admin).",
  "dataset.upload_failed": "The dataset upload failed.",
  "dataset.upload_cancel": "The dataset upload was cancelled.",
  "dataset.unsupported_file_type":
    "It looks like the selected file is not supported. WebKnossos only supports uploading zipped WKW datasets or image files.",
  "dataset.upload_zip_with_nml":
    "The archive you attached contains an NML file. If the archive is an annotation, please use the Annotations tab in the dashboard to upload it. Uploading annotations here won't succeed.",
  "dataset.upload_invalid_zip":
    "It looks like the selected file is not a valid zip file. Please ensure that your dataset is zipped to a single file and that the format is correct.",
  "dataset.leave_during_upload":
    "WARNING: The upload is still in progress and will be aborted when hitting OK. Please click cancel and wait until the upload is finished before leaving the page.",
  "dataset.leave_with_unsaved_changes":
    "There are unsaved changes for the dataset's configuration. Please click “Save” before leaving the page. To discard the changes click “Cancel”.",
  "dataset.add_success": "The dataset was added successfully.",
  "dataset.add_error": "Could not reach the datastore.",
  "dataset.add_zarr_different_scale_warning":
    "The explored data has a different voxel size from the datasource that was already loaded. The explored voxel size was:",
  "dataset.segmentationlayer_not_existing": "This annotation has no segmentation layer.",
  "dataset.invalid_datasource_json":
    "The datasource-properties.json on disk is invalid. Please review all properties below to use the dataset. You can always go back and change the values later.",
  "dataset.missing_datasource_json":
    "A datasource-properties.json file was not found. Please review all properties below to use the dataset. You can always go back and change the values later.",
  "dataset.import_complete":
    "A valid datasource-properties.json file was found. The dataset is imported and ready to use. You may still change the properties below.",
  "dataset.confirm_signup":
    "For dataset annotation, please log in or create an account. For dataset viewing, no account is required. Do you wish to sign up now?",
  "dataset.does_not_exist": "Selected dataset doesn't exist!",
  "dataset.name.already_taken":
    "This name is already being used by a different dataset. Please choose a different name.",
  "dataset.no_data": "No data available! Something seems to be wrong with the dataset.",
  "dataset.not_imported": "Please double check if you have the dataset imported:",
  "dataset.changed_without_reload":
    "Model.fetch was called for a task with another dataset, without reloading the page.",
  "dataset.import.required.name": "Please provide a name for the dataset.",
  "dataset.import.required.datastore": "Please select a datastore for the dataset.",
  "dataset.import.required.zipFile": "Please select a file to upload.",
  "dataset.import.required.url": "Please provide a URL to a dataset.",
  "dataset.import.required.folder": "Please define a target folder for this dataset.",
  "dataset.import.invalid_fields": "Please check that all form fields are valid.",
  "dataset.settings.updated_datasource_id_warning":
    "The datasource ID of a dataset must no be changed. The changes to the datasource ID will be ignored.",
  "dataset.unique_layer_names": "The layer names provided by the dataset are not unique.",
  "dataset.name_length": "Dataset name must be at least 3 characters",
  "dataset.unsupported_element_class": (layerName: string, elementClass: string) =>
    `The layer "${layerName}" was defined as ${elementClass}. This format is not officially supported. Please convert the layer to a supported format.`,
  "dataset.unsupported_segmentation_class_uint24":
    "The segmentation layer was defined as uint24. This format is not supported for segmentations. Please convert the layer to a supported format.",
  "dataset.is_scratch":
    "This dataset location is marked as 'scratch' and meant for testing only. Please move this dataset to a permanent storage location and reimport it.",
  "dataset.z1_downsampling_hint":
    "The currently rendered quality is not optimal due to the available magnifications and the viewport arrangement. To improve the quality try to increase the size of the XY viewport (e.g. by maximizing it).",
  "dataset.mag_explanation":
    "Layers contain image data in one or multiple magnifications. The image data in full resolution is referred to as the finest magnification, e.g. mag 1-1-1. Magnification 4-4-4 describes a downsampling factor of 4 in each dimension compared to mag 1-1-1.",
  "annotation.finish": "Are you sure you want to permanently finish this annotation?",
  "annotation.was_finished": "Annotation was archived",
  "annotation.no_fallback_data_included":
    "This download only includes the volume data annotated in this annotation. The fallback volume data is excluded.",
  "annotation.was_re_opened": "Annotation was reopened",
  "annotation.delete": "Do you really want to reset and cancel this annotation?",
  "annotation.was_edited": "Successfully updated annotation",
  "annotation.shared_teams_edited": "Successfully updated the sharing options for the annotation",
  "annotation.shared_teams_edited_failed":
    "Updating the sharing options for the annotation failed. Please retry or see the error message in the console.",
  "annotation.download": "The following annotation data is available for download immediately.",
  "annotation.export_no_worker":
    "This WEBKNOSSOS instance is not configured to run export jobs. To learn more about this feature please contact us at ",
  "annotation.register_for_token": "Please log in to get an access token for the script below.",
  "project.delete": "Do you really want to delete this project?",
  "project.increase_instances":
    "Do you really want to add one additional instance to all tasks of this project?",
  "project.none_selected": "No currently selected project found.",
  "project.successful_active_tasks_transfer":
    "All active tasks were transferred to the selected user",
  "project.unsuccessful_active_tasks_transfer":
    "An error occurred while trying to transfer the tasks. Please check your permissions and the server logs",
  "project.no_fallback_data_included":
    "This download does only include the volume data annotated in the tasks of this project. The fallback volume data is excluded.",
  "script.delete": "Do you really want to delete this script?",
  "team.delete": "Do you really want to delete this team?",
  "team.no_members": "This team has no members assigned yet.",
  "taskType.delete": "Do you really want to delete this task type and all its associated tasks?",
  "auth.registration_email_input": "Please input your E-mail!",
  "auth.registration_email_invalid": "The input is not valid E-mail!",
  "auth.registration_password_input": "Please input your password!",
  "auth.registration_password_confirm": "Please confirm your password!",
  "auth.registration_password_mismatch": "Passwords do not match!",
  "auth.registration_password_length": "Passwords needs min. 8 characters.",
  "auth.registration_firstName_input": "Please input your first name!",
  "auth.registration_lastName_input": "Please input your last name!",
  "auth.registration_org_input": "Please select an organization!",
  "auth.privacy_check_required":
    "Unfortunately, we cannot provide the service without your consent to the processing of your data.",
  "auth.tos_check_required":
    "Unfortunately, we cannot provide the service without your consent to our terms of service.",
  "auth.reset_logout": "You will be logged out, after successfully changing your password.",
  "auth.reset_old_password": "Please input your old password!",
  "auth.reset_new_password": "Please input your new password!",
  "auth.reset_new_password2": "Please repeat your new password!",
  "auth.reset_token": "Please input the token!",
  "auth.reset_token_not_supplied":
    "There was no token found in the URL. Check your E-Mails to get the correct URL.",
  "auth.reset_email_notification":
    "An email with instructions to reset your password has been send to you.",
  "auth.reset_pw_confirmation": "Your password was successfully changed",
  "auth.account_created":
    "Your account has been created. An administrator is going to unlock you soon.",
  "auth.automatic_user_activation": "User was activated automatically",
  "auth.error_no_user": "No active user is logged in.",
  "auth.error_no_organization": "No active organization can be loaded.",
  "auth.invalid_organization_name":
    "The link is not valid, since the specified organization does not exist. You are being redirected to the general registration form.",
  "request.max_item_count_alert":
    "Your request returned more than 1000 results. More results might be available on the server but were omitted for technical reasons.",
  "timetracking.date_range_too_long": "Please specify a date range of three months or less.",
  "nml.node_outside_tree":
    "NML contains <node ...> tag that is not enclosed by a <thing ...> tag: Node with id",
  "nml.edge_outside_tree":
    "NML contains <edge ...> tag that is not enclosed by a <thing ...> tag: Edge",
  "nml.metadata_entry_outside_tree":
    "NML contains <metadataEntry ...> tag that is not enclosed by a <thing ...> tag",
  "nml.expected_attribute_missing":
    "Attribute with the following name was expected, but is missing or empty:",
  "nml.invalid_timestamp": "Attribute with the following name was expected to be a unix timestamp:",
  "nml.invalid_tree_type":
    "Attribute with the following name was expected to be a valid tree type:",
  "nml.branchpoint_without_tree":
    "NML contains <branchpoint ...> with a node id that is not in any tree: Node with id",
  "nml.comment_without_tree":
    "NML contains <comment ...> with a node id that is not in any tree: Node with id",
  "nml.edge_with_invalid_node":
    "NML contains <edge ...> with a node id that is not part of the tree: Edge",
  "nml.tree_with_missing_group_id":
    "NML contains <tree ...> with a non-existing group id: Group with id",
  "nml.duplicate_tree_id": "NML contains <thing ...> with duplicate tree id: Tree with id",
  "nml.duplicate_node_id": "NML contains <node ...> with duplicate node id: Node with id",
  "nml.duplicate_group_id": "NML contains <group ...> with duplicate group id: Group with id",
  "nml.duplicate_edge": "NML contains a duplicate <edge ...>: Edge",
  "nml.edge_with_same_source_target":
    "NML contains <edge ...> with same source and target id: Edge",
  "nml.incomplete_bounds": "NML contains <userBoundingBox ...> with incomplete bounds properties.",
  "merge.different_dataset":
    "The merge cannot be executed, because the underlying datasets are not the same.",
  "merge.volume_unsupported": "Merging is not supported for volume annotations.",
  "users.needs_admin_rights": "Admin rights are required to change the permissions of users.",
  "users.multiple_selected_users":
    "You selected more than one user. To change the organization permissions of users you need to select them individually.",
  "users.change_permissions_title": "Do you really want to change the permissions of this user?",
  "users.revoke_all_permissions": _.template(
    "<%- userName %> is about lose all administrative privileges and any extra access permissions to datasets. As a regular WEBKNOSSOS member, access to datasets will be determined by the user's team memberships.",
  ),
  "users.set_dataset_manager": _.template(
    "<%- userName %> is about to become a dataset manager and will be able to access and edit all datasets within this organization.",
  ),
  "users.set_admin": _.template(
    "<%- userName %> is about to become an admin for this organization with full read/write access to all datasets and management capbilities for all users, projects, and tasks.",
  ),
  "users.change_email_title": "Do you really want to change the email?",
  "users.change_email": _.template(
    "Do you really want to change the email to '<%- newEmail %>' ? The corresponding user will be logged out and unsaved changes might be lost.",
  ),
  "users.change_email_confirmation": "The email has been changed",
  "mapping.too_big":
    "The mapping contains too many values, currently only up to 2^24 values are supported.",
  "mapping.unsupported_layer": "Mappings can only be enabled for segmentation layers.",
  "project.report.failed_to_refresh":
    "The project report page could not be refreshed. Please try to reload the page.",
  planned_maintenance:
    "WebKnossos is temporarily under maintenance. Please check back again in a few minutes.",
  "ui.moving_center_tab_into_border_error": "You cannot move this tab into a sidebar!",
  "ui.moving_border_tab_into_center_error": "You cannot move this tab out of this sidebar!",
  "ui.no_form_active": "Could not set the initial form values as the form could not be loaded.",
  "organization.plan.upgrage_request_sent":
    "An email with your upgrade request has been sent to the WEBKNOSSOS sales team.",
  "organization.plan.feature_not_available": (
    requiredPlan: string,
    organizationOwnerName: string,
  ) =>
    `This feature is not available in your organization's plan. Ask the owner of your organization ${organizationOwnerName} to upgrade to a ${requiredPlan} plan or higher.`,
  "organization.plan.feature_not_available.owner": (requiredPlan: string) =>
    `This feature is not available in your organization's plan. Consider upgrading to a ${requiredPlan} plan or higher.`,
};
