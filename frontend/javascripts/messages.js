// @flow
import _ from "lodash";
import type { Vector4 } from "oxalis/constants";

export const settings = {
  clippingDistance: "Clipping Distance",
  displayCrosshair: "Show Crosshairs",
  displayScalebars: "Show Scalebars",
  dynamicSpaceDirection: "d/f-Switching",
  invertColor: "Invert Color",
  keyboardDelay: "Keyboard delay (ms)",
  moveValue: "Move Value (nm/s)",
  newNodeNewTree: "Single-node-tree mode (Soma clicking)",
  highlightCommentedNodes: "Highlight Commented Nodes",
  nodeRadius: "Node Radius",
  overrideNodeRadius: "Override Node Radius",
  particleSize: "Particle Size",
  tdViewDisplayPlanes: "Display Planes in 3D View",
  fourBit: "4 Bit",
  interpolation: "Interpolation",
  quality: "Quality",
  segmentationOpacity: "Segmentation Opacity",
  highlightHoveredCellId: "Highlight Hovered Cells",
  zoom: "Zoom",
  renderMissingDataBlack: "Render Missing Data Black",
  clippingDistanceArbitrary: "Clipping Distance",
  moveValue3d: "Move Value (nm/s)",
  mouseRotateValue: "Mouse Rotation",
  rotateValue: "Keyboard Rotation",
  sphericalCapRadius: "Sphere Radius",
  crosshairSize: "Crosshair Size",
  brushSize: "Brush Size",
  segmentationPatternOpacity: "Pattern Opacity",
  userBoundingBoxes: "Bounding Boxes",
  loadingStrategy: "Loading Strategy",
  loadingStrategyDescription: `You can choose between loading the best quality first
    (will take longer until you see data) or alternatively,
    improving the quality progressively (data will be loaded faster,
    but it will take more time until the best quality is shown).`,
  mergerMode: "Enable Merger Mode",
  gpuMemoryFactor: "Hardware Utilization",
  autoBrush: "Automatic Brush (Beta)",
  overwriteMode: "Volume Annotation Overwrite Mode",
};

export const layerViewConfigurations = {
  color: "Color",
  alpha: "Layer opacity",
  intensityRange: "Intensity Range",
  min: "Minimum Data Value",
  max: "Maximum Data Value",
  isDisabled: "Disabled Layer",
  isInverted: "Inverted Layer",
  isInEditMode: "Configuration Mode",
};

export default {
  yes: "Yes",
  no: "No",
  unknown_error:
    "An unknown error occurred. Please try again or check the console for more details.",
  offline:
    "The communication to the server failed. This can happen when you are offline or when the server is down. Retrying...",
  "datastore.health": _.template(
    "The datastore server at <%- url %> does not seem too be available. Please check back in five minutes.",
  ),
  "datastore.version.too_new": _.template(
    "The datastore server at (<%- url %>) supplies a newer API version (<%- suppliedDatastoreApiVersion %>) than this webKnossos expects (<%- expectedDatastoreApiVersion %>). Please contact your admins to upgrade this webKnossos instance",
  ),
  "datastore.version.too_old": _.template(
    "The datastore server at (<%- url %>) supplies an older API version (<%- suppliedDatastoreApiVersion %>) than this webKnossos expects (<%- expectedDatastoreApiVersion %>). Please contact the admins of the remote data store to upgrade.",
  ),
  "save.failed_simultaneous_tracing": `The annotation couldn't be processed correctly.

This might be caused by editing the annotation simultaneously in different windows.
Editing should be done in a single window only.

In order to restore the current window, a reload is necessary.`,
  "react.rendering_error":
    "Unfortunately, we encountered an error during rendering. We cannot guarantee that your work is persisted. Please reload the page and try again.",
  "save.leave_page_unfinished":
    "WARNING: You have unsaved progress that may be lost when hitting OK. Please click cancel, wait until the progress is saved and the save button displays a checkmark before leaving the page..",
  "save.failed": "Failed to save annotation. Retrying.",
  "undo.no_undo":
    "There is no action that could be undone. However, if you want to restore an earlier version of this annotation, use the 'Restore Older Version' functionality in the dropdown next to the 'Save' button.",
  "undo.no_redo": "There is no action that could be redone.",
  "undo.import_volume_tracing":
    "Importing a volume tracing cannot be undone. However, if you want to restore an earlier version of this annotation, use the 'Restore Older Version' functionality in the dropdown next to the 'Save' button.",
  "download.wait": "Please wait...",
  "download.close_window": "You may close this window after the download has started.",
  "add_script.confirm_change": "This will replace the code you have written. Continue?",
  "data.enabled_render_missing_data_black":
    "You just enabled the option to render missing data black. All layers will now be reloaded.",
  "data.disabled_render_missing_data_black": `You just disabled the option to render missing
data black. This means that in case of missing data, data of lower quality is rendered
instead. Only enable this option if you understand its effect. All layers will now be reloaded.`,
  "sampling.could_not_get_or_create_bucket": (zoomedAddress: Vector4) =>
    `While sampling could not get or create bucket at address ${zoomedAddress.toString()}.`,
  "tracing.unhandled_initialization_error":
    "Initialization error. Please refresh the page to retry. If the error persists, please contact an administrator.",
  "tracing.out_of_dataset_bounds":
    "The current position is outside of the dataset's bounding box. No data will be shown here.",
  "tracing.out_of_task_bounds": "The current position is outside of the task's bounding box.",
  "tracing.copy_position": "Copy position to clipboard.",
  "tracing.copy_rotation": "Copy rotation to clipboard.",
  "tracing.sharing_modal_basic_information": (sharingActiveNode?: boolean) =>
    `This link includes the ${
      sharingActiveNode ? "active tree node," : ""
    } current position and zoom value. Consider fine-tuning your current view before copying the URL.`,
  "tracing.copy_cell_id": "Hit CTRL + I to copy the currently hovered cell id",
  "tracing.copy_maybe_mapped_cell_id":
    "Hit CTRL + I to copy the currently hovered cell id. Press CTRL + ALT + I if you want to copy the mapped id.",
  "tracing.no_more_branchpoints": "No more branchpoints",
  "tracing.branchpoint_set": "Branchpoint set",
  "tracing.branchpoint_jump_twice":
    "You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
  "tracing.edit_volume_in_merger_mode":
    "The volume annotation would be changed by this action. This is not allowed while merger mode is active.",
  "tracing.volume_resolution_mismatch":
    "The volume annotation resolutions do not match the dataset resolutions. Was the dataset edited after creating the annotation? Consider downloading and re-uploading resolution 1 only to adapt the annotation.",
  "tracing.segmentation_zoom_warning":
    "Segmentation data and volume annotation is only fully supported at a smaller zoom level.",
  "tracing.uint64_segmentation_warning":
    "This is an unsigned 64-bit segmentation. The displayed ids are truncated to 32-bit. Thus, they might not match the ids on the server.",
  "tracing.segmentation_zoom_warning_agglomerate":
    "Segmentation data which is mapped using an agglomerate file cannot be rendered in this resolution. Please zoom in further.",
  "tracing.no_access": "You are not allowed to access this annotation.",
  "tracing.no_allowed_mode": "There was no valid allowed annotation mode specified.",
  "tracing.volume_missing_segmentation": "Volume is allowed, but segmentation does not exist.",
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
    "A corruption in the current skeleton annotation was detected. Please contact your supervisor and/or the maintainers of webKnossos to get help for restoring a working version. Please include as much details as possible about your past user interactions. This will be very helpful to investigate the source of this bug.",
  "tracing.merger_mode_node_outside_segment":
    "You cannot place nodes outside of a segment in merger mode.",
  "tracing.not_isosurface_available_to_download": [
    "There is no isosurface for the active segment id available to download.",
    'Click with "CTRL + Left Mouse" on the desired cell to load it\'s isosurface.',
  ],
  "tracing.confirm_remove_fallback_layer.title":
    "Are you sure you want to unlink the dataset's original segmentation layer?",
  "tracing.confirm_remove_fallback_layer.explanation":
    "This dataset already contains a segmentation layer provided by its author. If you do not wish to base your work on this original segmentation, you can unlink it by confirming this dialog.",
  "tracing.confirm_remove_fallback_layer.notes":
    "Note that this action also removes segments which were already annotated manually. This step cannot be undone.",
  "tracing.area_to_fill_is_too_big":
    "The area you want to fill is too big. Please annotate the area in multiple strokes.",
  "layouting.missing_custom_layout_info":
    "The annotation views are separated into four classes. Each of them has their own layouts. If you can't find your layout please open the annotation in the correct view mode or just add it here manually.",
  "datastore.unknown_type": "Unknown datastore type:",
  "webgl.disabled": "Couldn't initialise WebGL, please make sure WebGL is enabled.",
  "webgl.context_loss":
    "Unfortunately, WebGL crashed. Please ensure that your graphics card driver is up to date to avoid such crashes. If this message keeps appearing, you can also try to lower the data rendering quality in the settings. Restarting your browser might also help.",
  "webgl.too_many_active_layers": _.template(
    "Your hardware cannot render all layers of this dataset simultaneously. Please ensure that not more than <%- maximumLayerCountToRender %> layers are enabled in the sidebar settings.",
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
    "If you reopen your old tracing, the current annotation will not be finished or cancelled. Instead, it will remain open and you can find it in the dashboard to continue annotating.",
  "task.bulk_create_invalid":
    "Can not parse task specification. It includes at least one invalid task. (Note that the obsolete “team” column was recently removed, are you still using the old format?)",
  "task.recommended_configuration": "The author of this task suggests to use these settings:",
  "dataset.clear_cache_success": _.template(
    "The dataset <%- datasetName %> was reloaded successfully.",
  ),
  "dataset.delete_success": _.template(
    "The dataset <%- datasetName %> was successfully deleted on disk. Redirecting to dashboard...",
  ),
  "task.no_tasks_to_download": "There are no tasks available to download.",
  "dataset.upload_success": "The dataset was uploaded successfully.",
  "dataset.upload_failed": "The dataset upload failed.",
  "dataset.add_success": "The dataset was added successfully.",
  "dataset.add_error": "Could not reach the datastore.",
  "dataset.segmentationlayer_not_existing": "This tracing has no segmentation layer.",
  "dataset.invalid_datasource_json":
    "The datasource-properties.json on disk is invalid. Please review all properties before importing the dataset. You can always go back and change the values later.",
  "dataset.missing_datasource_json":
    "The datasource-properties.json was not found. The values below are guessed by webKnossos. Please review all properties before importing the dataset. You can always go back and change the values later.",
  "dataset.import_complete":
    "A valid datasource-properties.json was found. The dataset is imported and ready to use. You may still change the properties below.",
  "dataset.confirm_signup":
    "For dataset annotation, please log in or create an account. For dataset viewing, no account is required. Do you wish to sign up now?",
  "dataset.does_not_exist": "Selected dataset doesn't exist!",
  "dataset.no_data": "No data available! Something seems to be wrong with the dataset.",
  "dataset.not_imported": "Please double check if you have the dataset imported:",
  "dataset.changed_without_reload":
    "Model.fetch was called for a task with another dataset, without reloading the page.",
  "dataset.import.required.name": "Please provide a name for the dataset.",
  "dataset.import.required.datastore": "Please select a datastore for the dataset.",
  "dataset.import.required.zipFile": "Please select a file to upload.",
  "dataset.import.required.url": "Please provide a URL to a dataset.",
  "dataset.import.required.initialTeam": "Please select at least one team you manage.",
  "dataset.import.invalid_fields": "Please check that all form fields are valid.",
  "dataset.unique_layer_names": "The layer names provided by the dataset are not unique.",
  "dataset.unsupported_element_class": (layerName: string, elementClass: string) =>
    `The layer "${layerName}" was defined as ${elementClass}. This format is not officially supported. Please convert the layer to a supported format.`,
  "dataset.unsupported_segmentation_class":
    "The segmentation layer was defined as uint24. This format is not supported for segmentations. Please convert the layer to a supported format.",
  "dataset.is_scratch":
    "This dataset location is marked as 'scratch' and meant for testing only. Please move this dataset to a permanent storage location and reimport it.",
  "dataset.resolution_mismatch":
    "This dataset contains multiple layers which differ in their resolution. Please convert the layers to make their resolutions match. Otherwise, rendering errors cannot be avoided.",
  "annotation.finish": "Are you sure you want to permanently finish this annotation?",
  "annotation.was_finished": "Annotation was archived",
  "annotation.no_fallback_data_included":
    "This download does only include the volume data annotated in this annotation. The fallback volume data is excluded.",
  "annotation.was_re_opened": "Annotation was reopened",
  "annotation.delete": "Do you really want to reset and cancel this annotation?",
  "annotation.was_edited": "Successfully updated annotation",
  "annotation.shared_teams_edited": "Successfully updated the shared teams for the annotation",
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
  "auth.invalid_organization_name":
    "The link is not valid, since the specified organization does not exist. You are being redirected to the general registration form.",
  "request.max_item_count_alert":
    "Your request returned more than 1000 results. More results might be available on the server but were omitted for technical reasons.",
  "timetracking.date_range_too_long": "Please specify a date range of 31 days or less.",
  "nml.node_outside_tree":
    "NML contains <node ...> tag that is not enclosed by a <thing ...> tag: Node with id",
  "nml.edge_outside_tree":
    "NML contains <edge ...> tag that is not enclosed by a <thing ...> tag: Edge",
  "nml.expected_attribute_missing":
    "Attribute with the following name was expected, but is missing or empty:",
  "nml.invalid_timestamp": "Attribute with the following name was expected to be a unix timestamp:",
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
    "<%- userName %> is about lose all administrative privileges and any extra access permissions to datasets. As a regular webKnossos member, access to datasets will be determined by the user's team memberships.",
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
  "mapping.too_few_textures":
    "Not enough textures available to support mappings. Mappings are disabled.",
  "mapping.unsupported_layer": "Mappings can only be enabled for segmentation layers.",
  "project.report.failed_to_refresh":
    "The project report page could not be refreshed. Please try to reload the page.",
  planned_maintenance:
    "WebKnossos is temporarily under maintenance. Please check back again in a few minutes.",
};
