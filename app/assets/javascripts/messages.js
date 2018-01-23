// @flow
export default {
  yes: "Yes",
  no: "No",
  "save.failed_simultaneous_tracing": `It seems that you edited the tracing simultaneously in different windows.
Editing should be done in a single window only.

In order to restore the current window, a reload is necessary.`,
  "save.failed_client_error": `We've encountered a permanent error while trying to save.

In order to restore the current window, a reload is necessary.`,
  "save.leave_page_unfinished":
    "You haven't saved your progress, please give us 2 seconds to do so and and then leave this site.",
  "save.failed": "Failed to save tracing. Retrying.",
  "undo.no_undo": "There is no action that could be undone.",
  "undo.no_redo": "There is no action that could be redone.",
  "download.wait": "Please wait...",
  "download.close_window": "You may close this window after the download has started.",
  "add_script.confirm_change": "This will replace the code you have written. Continue?",
  "tracing.copy_position": "Click this button to copy the position.",
  "tracing.copy_rotation": "Click this button to copy the rotation.",
  "tracing.no_more_branchpoints": "No more branchpoints",
  "tracing.branchpoint_set": "Branchpoint set",
  "tracing.branchpoint_jump_twice":
    "You didn't add a node after jumping to this branchpoint, do you really want to jump again?",
  "tracing.segmentation_zoom_warning":
    "Segmentation data and volume tracing is only fully supported at a smaller zoom level.",
  "tracing.no_access": "You are not allowed to access this tracing.",
  "tracing.no_allowed_mode": "There was no valid allowed tracing mode specified.",
  "tracing.volume_missing_segmentation": "Volume is allowed, but segmentation does not exist.",
  "tracing.delete_initial_node": "Do you really want to delete the initial node?",
  "tracing.delete_tree": "Do you really want to delete the whole tree?",
  "tracing.delete_tree_with_initial_node":
    "This tree contains the initial node. Do you really want to delete the whole tree?",
  "tracing.merged": "Merging successfully done",
  "tracing.tree_viewer_no_cyclic_trees":
    "Cyclic trees are not supported by the abstract tree viewer.",
  "datastore.unknown_type": "Unknown datastore type:",
  "webgl.disabled": "Couldn't initialise WebGL, please make sure WebGL is enabled.",
  "task.user_script_retrieval_error": "Unable to retrieve script",
  "task.new_description": "You are now tracing a new task with the following description",
  "task.no_description": "You are now tracing a new task with no description.",
  "task.delete": "Do you really want to delete this task?",
  "task.reset_success": "Annotation was successfully reset.",
  "task.bulk_create_invalid":
    "Can not parse task specification. It includes at least one invalid task.",
  "dataset.upload_success": "The dataset was uploaded successfully",
  "dataset.ndstore_success":
    "The dataset was successfully added to webKnossos from the specified NDStore.",
  "dataset.confirm_signup":
    "For dataset annotation, please log in or create an account. For dataset viewing, no account is required. Do you wish to sign up now?",
  "dataset.does_not_exist": "Selected dataset doesn't exist!",
  "dataset.no_data": "No data available! Something seems to be wrong with the dataset.",
  "dataset.not_imported": "Please double check if you have the dataset imported:",
  "dataset.changed_without_reload":
    "Model.fetch was called for a task with another dataset, without reloading the page.",
  "annotation.finish": "Are you sure you want to permanently finish this tracing?",
  "annotation.was_finished": "Annotation was archived",
  "annotation.was_re_opened": "Annotation was reopened",
  "annotation.delete": "Do you really want to cancel this annotation?",
  "annotation.dataset_no_public":
    "Public tracings require the respective dataset to be public too. Please, make sure to add public access rights to the dataset as well.",
  "annotation.was_edited": "Successfully updated annotation",
  "project.delete": "Do you really want to delete this project?",
  "script.delete": "Do you really want to delete this script?",
  "team.delete": "Do you really want to delete this team?",
  "taskType.delete": "Do you really want to delete this task type?",
  "auth.registration_email_input": "Please input your E-mail!",
  "auth.registration_email_invalid": "The input is not valid E-mail!",
  "auth.registration_password_input": "Please input your password!",
  "auth.registration_password_confirm": "Please confirm your password!",
  "auth.registration_password_missmatch": "Passwords do not match!",
  "auth.registration_password_length": "Passwords needs min. 8 characters.",
  "auth.registration_firstName_input": "Please input your first name!",
  "auth.registration_lastName_input": "Please input your last name!",
  "auth.registration_team_input": "Please select a team!",
  "auth.reset_logout": "You will be logged out, after successfully changing your password.",
  "auth.reset_old_password": "Please input your old password!",
  "auth.reset_new_password": "Please input your new password!",
  "auth.reset_new_password2": "Please repeat your new password!",
  "auth.reset_token": "Please input the token!",
  "auth.reset_email_notification":
    "An email with instructions to reset your password has been send to you.",
  "auth.reset_pw_confirmation": "Your password was successfully changed",
  "auth.account_created":
    "Your account has been created. An administrator is going to unlock you soon.",
  "auth.automatic_user_activation": "User was activated automatically",
  "auth.error_no_user": "No active user is logged in.",
  "request.max_item_count_alert":
    "Your request returned more than 1000 results. More results might be available on the server but were omitted for technical reasons.",
  "timetracking.date_range_too_long": "Please specify a date range of 31 days or less.",
  "nml.node_outside_tree":
    "NML contains <node ...> tag that is not enclosed by a <thing ...> tag: Node with id",
  "nml.edge_outside_tree":
    "NML contains <edge ...> tag that is not enclosed by a <thing ...> tag: Edge",
  "nml.expected_attribute_missing":
    "Attribute with the following name was expected, but is missing:",
  "nml.branchpoint_without_tree":
    "NML contains <branchpoint ...> with a node id that is not in any tree: Node with id",
  "nml.comment_without_tree":
    "NML contains <comment ...> with a node id that is not in any tree: Node with id",
  "nml.edge_with_invalid_node":
    "NML contains <edge ...> with a node id that is not part of the tree: Edge",
  "nml.duplicate_tree_id": "NML contains <thing ...> with duplicate tree id: Tree with id",
  "nml.duplicate_node_id": "NML contains <node ...> with duplicate node id: Node with id",
  "nml.edge_with_same_source_target":
    "NML contains <edge ...> with same source and target id: Edge",
  "nml.tree_not_connected": "NML contains tree that is not fully connected: Tree with id",
  "nml.different_dataset": "Imported NML was originally for a different dataset.",
};
