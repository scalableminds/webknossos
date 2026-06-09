### Uploading through Python
For those wishing to automate dataset upload or to do it programmatically, check out the WEBKNOSSOS [Python library](https://docs.webknossos.org/webknossos-py/). You can create, manage and upload datasets with the Python library.

The following example creates a dataset from a folder of images, optimizes it, and uploads it to WEBKNOSSOS:

```python
from pathlib import Path

import webknossos as wk


def main() -> None:
    # Log in using your API token from https://webknossos.org/account/token
    wk.login(token="YOUR_API_TOKEN")

    dataset = wk.Dataset.from_images(
        Path("./testdata/tiff"),
        "tiff_dataset_upload",
        voxel_size=(12, 12, 12),
    )
    dataset.compress()
    dataset.downsample()

    remote_dataset = dataset.upload()
    url = remote_dataset.url
    print(f"Successfully uploaded {url}")


if __name__ == "__main__":
    main()
```

Uploading requires authentication with an API token; you can find it in your [user profile settings](../users/password.md#authentication-token). For more examples, refer to the [Python library documentation](https://docs.webknossos.org/webknossos-py).