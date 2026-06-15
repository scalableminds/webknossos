# Data Export through Python

The [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) makes it very easy to download/upload any of your organization's datasets, and annotations. For detailed info, please refer to the `webknossos-libs` [documentation website for guides and tutorials](https://docs.webknossos.org/webknossos-py/).

There are also quick start instructions for Python download available directly from the [WEBKNOSSOS UI](./export_ui.md).

## Example Snippets

The WEBKNOSSOS Python library can be installed using pip. We recommend to use a virtual environment, e.g. with [`uv`](https://github.com/astral-sh/uv).

```bash
pip install webknossos
```

##### Downloading Annotations
```python
import webknossos as wk

with wk.webknossos_context(
    token="<your_api_token>",
    url="https://webknossos.org"
):
    annotation = wk.Annotation.download("<annotation_id>")
```

##### Downloading Datasets

```python
import webknossos as wk

with wk.webknossos_context(token="<your_api_token>", url="https://webknossos.org"):
    # Get a reference to the dataset without downloading it. 
    # Image data will be streamed when being accessed.
    remote_dataset = wk.Dataset.open_remote(
        dataset_id="<dataset_id>",
    )

    # You can access dataset layers via keys and as attributes.
    color_layer = remote_dataset.get_layer("color")
```

## Authentication

WEBKNOSSOS requires you to authenticate yourself via an API Token to access your data. You can find your API Token in your [user profile settings](../users/password.md#authentication-token).