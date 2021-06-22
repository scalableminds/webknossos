If you wish to start the webKnossos datastore module after booting, you can use the provided service file.
There are only a few steps required to set it up.

1. Change the paths in the provided service file from `PATH` to the actual directory, where the webKnossos datastore module is located.
2. Modify the service file's permissions to `640` by using `chmod 640 webknossos.service`. 
3. Change the owner and the group of the file to `root` by using `sudo chown root webknossos.service` and `sudo chgrp root webknossos.service`.
4. Move the `webknossos.service` file to `/etc/systemd/system/`.
5. Use `sudo systemctl daemon-reload` to update the systemd files.
6. Enable the service to start after booting by using `sudo systemctl enable webknossos.service`.
7. If you wish to directly start the service, use `sudo systemctl start webknossos.service`.

To inspect the logs of the running webKnossos datastore module, you can use `journalctl -u webknossos`.