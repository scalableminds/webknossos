// @flow
import _ from "lodash";

export const settings = {
  clippingDistance: "Clipping Distance",
  displayCrosshair: "Show Crosshairs",
  displayScalebars: "Show Scalebars",
  dynamicSpaceDirection: "d/f-Switching",
  keyboardDelay: "Keyboard delay (ms)",
  moveValue: "Move Value (nm/s)",
  newNodeNewTree: "Single-node-tree mode (Soma clicking)",
  highlightCommentedNodes: "Highlight Commented Nodes",
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
  userBoundingBox: "Bounding Box",
};

export default {
  yes: "Yes",
  no: "No",
  unknown_error:
    "An unknown error occured. Please try again or check the console for more details.",
  "datastore.health": _.template(
    "The datastore server at <%- url %> does not seem too be available. Please check back in five minutes.",
  ),
  "datastore.version.too_new": _.template(
    "The datastore server at (<%- url %>) supplies a newer API version (<%- suppliedDatastoreApiVersion %>) than this webKnossos expects (<%- expectedDatastoreApiVersion %>). Please contact your admins to upgrade this webKnossos instance",
  ),
  "datastore.version.too_old": _.template(
    "The datastore server at (<%- url %>) supplies an older API version (<%- suppliedDatastoreApiVersion %>) than this webKnossos expects (<%- expectedDatastoreApiVersion %>). Please contact the admins of the remote data store to upgrade.",
  ),
  "save.failed_simultaneous_tracing": `It seems that you edited the tracing simultaneously in different windows.
Editing should be done in a single window only.

In order to restore the current window, a reload is necessary.`,
  "react.rendering_error":
    "Unfortunately, we encountered an error during rendering. We cannot guarantee that your work is persisted. Please reload the page and try again.",
  "save.leave_page_unfinished":
    "WARNING: You have unsaved progress that may be lost when hitting OK. Please click cancel, wait until the progress is saved and the save button displays a checkmark before leaving the page..",
  "save.failed": "Failed to save tracing. Retrying.",
  "undo.no_undo":
    "There is no action that could be undone. However, if you want to restore an earlier version of this tracing, use the 'Restore Older Version' functionality in the dropdown next to the 'Save' button.",
  "undo.no_redo": "There is no action that could be redone.",
  "download.wait": "Please wait...",
  "download.close_window": "You may close this window after the download has started.",
  "add_script.confirm_change": "This will replace the code you have written. Continue?",
  "data.enabled_render_missing_data_black":
    "You just enabled the option to render missing data black. Please refresh this page so that the changes can take effect.",
  "data.disabled_render_missing_data_black": `You just disabled the option to render missing
  data black. This means that in case of missing data, data of lower quality is rendered
  instead. Only enable this option if you understand its effect. Please refresh
  this page so that the changes can take effect.`,
  "tracing.copy_position": "Click this button to copy the position.",
  "tracing.copy_rotation": "Click this button to copy the rotation.",
  "tracing.copy_cell_id": "Hit CTRL + I to copy the currently hovered cell id",
  "tracing.copy_maybe_mapped_cell_id":
    "Hit CTRL + I to copy the currently hovered cell id. Press CTRL + ALT + I if you want to copy the mapped id.",
  "tracing.no_more_branchpoints": "No more branchpoints",
  "tracing.branchpoint_set": "Branchpoint set",
  "tracing.branchpoint_jump_twice":
    "You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
  "tracing.segmentation_zoom_warning":
    "Segmentation data and volume tracing is only fully supported at a smaller zoom level.",
  "tracing.segmentation_downsampled_data_warning":
    "Segmentation data is downsampled at this zoom step. This may lead to misleading data rendering. Please zoom in further to see unsampled data.",
  "tracing.no_access": "You are not allowed to access this tracing.",
  "tracing.no_allowed_mode": "There was no valid allowed tracing mode specified.",
  "tracing.volume_missing_segmentation": "Volume is allowed, but segmentation does not exist.",
  "tracing.delete_initial_node": "Do you really want to delete the initial node?",
  "tracing.delete_tree": "Do you really want to delete the whole tree?",
  "tracing.delete_tree_with_initial_node":
    "This tree contains the initial node. Do you really want to delete the whole tree?",
  "tracing.delete_mulitple_trees": _.template(
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
  "tracing.cant_create_node_due_to_active_group":
    "You cannot create nodes, since no tree is active.",
  "tracing.invalid_state":
    "A corruption in the current skeleton tracing was detected. Please contact your supervisor and/or the maintainers of webKnossos to get help for restoring a working version. Please include as much details as possible about your past user interactions. This will be very helpful to investigate the source of this bug.",
  "layouting.missing_custom_layout_info":
    "The tracing views are separated into four classes. Each of them has their own layouts. If you can't find your layout please open the tracing in the correct view mode or just add it here manually.",
  "datastore.unknown_type": "Unknown datastore type:",
  "webgl.disabled": "Couldn't initialise WebGL, please make sure WebGL is enabled.",
  "webgl.context_loss":
    "Unfortunately, WebGL crashed. Please ensure that your graphics card driver is up to date to avoid such crashes. If this message keeps appearing, restarting your browser might also help.",
  "task.user_script_retrieval_error": "Unable to retrieve script",
  "task.new_description": "You are now tracing a new task with the following description",
  "task.no_description": "You are now tracing a new task with no description.",
  "task.delete": "Do you really want to delete this task?",
  "task.request_new": "Do you really want another task?",
  "task.peek_next": _.template(
    "The next task will most likely be part of project <%- projectName %>",
  ),
  "task.confirm_reset": "Do you really want to reset this task?",
  "task.domain_does_not_exist":
    "No matching experience domain. Assign this domain to a user to add it to the listed options.",
  "annotation.reset_success": "Annotation was successfully reset.",
  "task.bulk_create_invalid":
    "Can not parse task specification. It includes at least one invalid task.",
  "task.recommended_configuration": "The author of this task suggests to use these settings:",
  "dataset.clear_cache_success": "The dataset was reloaded successfully",
  "dataset.upload_success": "The dataset was uploaded successfully",
  "dataset.invalid_datasource_json":
    "The datasource-properties.json on disk is invalid. The values below are guessed by webKnossos. Please review all properties before importing the dataset. You can always go back and change the values later.",
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
  "dataset.import.required.name": "Please provide a name for the dataset",
  "dataset.import.required.datastore": "Please select a datastore for the dataset",
  "dataset.import.required.zipFile": "Please select a file to upload.",
  "dataset.import.invalid_fields": "Please check that all form fields are valid.",
  "dataset.unique_layer_names": "The layer names provided by the dataset are not unique.",
  "dataset.is_scratch":
    "This dataset location is marked as 'scratch' and meant for testing only. Please move this dataset to a permanent storage location and reimport it.",
  "annotation.finish": "Are you sure you want to permanently finish this tracing?",
  "annotation.was_finished": "Annotation was archived",
  "annotation.was_re_opened": "Annotation was reopened",
  "annotation.delete": "Do you really want to reset and cancel this annotation?",
  "annotation.was_edited": "Successfully updated annotation",
  "project.delete": "Do you really want to delete this project?",
  "project.increase_instances":
    "Do you really want to add one additional instance to all tasks of this project?",
  "project.none_selected": "No currently selected project found.",
  "project.successful_active_tasks_transfer":
    "All active tasks were transfered to the selected user",
  "project.unsuccessful_active_tasks_transfer":
    "An error occured while trying to transfer the tasks. Please check your permissions and the server logs",
  "script.delete": "Do you really want to delete this script?",
  "team.delete": "Do you really want to delete this team?",
  "taskType.delete": "Do you really want to delete this task type and all its associated tasks?",
  "auth.registration_email_input": "Please input your E-mail!",
  "auth.registration_email_invalid": "The input is not valid E-mail!",
  "auth.registration_password_input": "Please input your password!",
  "auth.registration_password_confirm": "Please confirm your password!",
  "auth.registration_password_missmatch": "Passwords do not match!",
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
  "nml.tree_not_connected": "NML contains tree that is not fully connected: Tree with id",
  "nml.different_dataset":
    "At least one NML file was originally created for a different dataset. Are you sure you want to continue with the import?",
  "merge.different_dataset":
    "The merge cannot be executed, because the underlying datasets are not the same.",
  "merge.volume_unsupported": "Merging is not supported for volume tracings.",
  "users.is_admin":
    "At least one of the selected users is an admin of this organization and already has access to all teams. No team assignments are necessary for this user.",
  "users.grant_admin_rights_title": "Do you really want to grant admin rights?",
  "users.grant_admin_rights": _.template(
    "You are about to grant admin privileges to <%- numUsers %> user(s) giving them access to all teams, datasets and annotations. Do you want to proceed?",
  ),
  "users.revoke_admin_rights_title": "Do you really want to revoke admin rights?",
  "users.revoke_admin_rights": _.template(
    "You are about to revoke admin privileges from <%- numUsers %> user(s). Do you want to proceed?",
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
