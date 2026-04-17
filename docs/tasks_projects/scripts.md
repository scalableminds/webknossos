# Scripts

Scripts let you run custom JavaScript logic automatically when annotators open assigned tasks.
They are useful for project-specific keyboard shortcuts, UI helpers, and task setup automation.

For API details, see the WEBKNOSSOS [Frontend API documentation](https://webknossos.org/assets/docs/frontend-api/index.html).

## Create a Script

1. Open the `Scripts` page in the administration section.
2. Click `Add Script`.
3. Fill in:
   - `Script Name`: Human-readable label shown in selectors.
   - `Gist URL`: URL of the script source, a public [GitHub Gist](https://gist.github.com/) that your setup can access.
   - `Owner`: User responsible for maintaining the script.
4. Save the script.

After saving, the script appears in the Scripts list and can be selected from the WEBKNOSSOS viewer or during task creation.

## Example Script

```javascript
/**
 * Example: WebKnossos Custom SkeletonNode Tagger
 * ----------------------------
 * Description: Automatically assigns specific labels to the currently 
 * selected tracing node using keyboard shortcuts. This bypasses manual 
 * menu entry to speed up synaptic annotation.
 * * Usage: 
 * - Press '4' to label active node as "syn shaft"
 * - Press '5' to label active node as "syn spineHead"
 */

window.webknossos.apiReady(3).then((api) => {
    // Helper: Fetches active node and applies the string to the comment field
    const tagNode = (comment) => {
        const nodeId = api.tracing.getActiveNodeId();
        if (nodeId) {
            api.tracing.setCommentForNode(comment, nodeId);
        }
    };

    // Keyboard Listeners
    api.utils.registerKeyHandler("4", () => tagNode("syn shaft"));
    api.utils.registerKeyHandler("5", () => tagNode("syn spineHead"));
});
```

## Run Script from WEBKNOSSOS Annotation Viewer

You can access and run scripts directly from within the WEBKNOSSOS annotation viewer.

1. Open the Menu dropdown in the top navigation bar.
2. Select "Add Script".
3. Either select an available script from the list or enter your script code directly in the text box.
4. Click "Run Script".

!!! warning "Security Warning"
    Scripts are loaded from external URLs (GitHub Gists) and executed directly in the browser with full access to the WEBKNOSSOS annotation API. **Always review a script's source before running it.** Never run scripts from untrusted authors or URLs you do not control, as malicious code could modify your annotations or exfiltrate data.

## Assign a Script to Tasks

You can attach a script when creating or editing tasks:

1. Open `Tasks` and click `Add Task` (or edit an existing task).
2. In the form, select the desired entry in the `Script` field.
3. Save the task.

When users work on such a task, WEBKNOSSOS loads and executes the configured script.

## Use Scripts in Bulk Task Creation

The bulk CSV input for task creation supports an optional `scriptId` column.

- If `scriptId` is set, the corresponding script is attached to the task.
- If `scriptId` is empty, no script is attached.

See [Tasks](tasks.md) for general bulk task creation workflow.

## Update or Remove Scripts

- Edit an existing script from the `Scripts` list to update name, URL, or owner.
- Delete unused scripts from the same list.

If a script is already referenced by tasks, update those tasks if you intend to switch to a different script.

## Best Practices

- Keep scripts focused and task-specific.
- Version changes in your Gist history.
- Test scripts with a small set of tasks before broad rollout.
- Document required user interactions directly in the Task Type or Task description.


