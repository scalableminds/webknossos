package com.scalableminds.webknossos.datastore.s3fs;

import static java.lang.String.format;

import java.nio.file.AccessDeniedException;
import java.nio.file.AccessMode;
import java.util.EnumSet;

import com.amazonaws.services.s3.model.AccessControlList;
import com.amazonaws.services.s3.model.Grant;
import com.amazonaws.services.s3.model.Owner;
import com.amazonaws.services.s3.model.Permission;

public class S3AccessControlList {
    private String fileStoreName;
    private String key;
    private AccessControlList acl;
    private Owner owner;

    public S3AccessControlList(String fileStoreName, String key, AccessControlList acl, Owner owner) {
        this.fileStoreName = fileStoreName;
        this.acl = acl;
        this.key = key;
        this.owner = owner;
    }

    public String getKey() {
        return key;
    }

    /**
     * have almost one of the permission set in the parameter permissions
     *
     * @param permissions almost one
     * @return
     */
    private boolean hasPermission(EnumSet<Permission> permissions) {
        for (Grant grant : acl.getGrantsAsList())
            if (grant.getGrantee().getIdentifier().equals(owner.getId()) && permissions.contains(grant.getPermission()))
                return true;
        return false;
    }

    public void checkAccess(AccessMode[] modes) throws AccessDeniedException {
        for (AccessMode accessMode : modes) {
            switch (accessMode) {
                case EXECUTE:
                    throw new AccessDeniedException(fileName(), null, "file is not executable");
                case READ:
                    if (!hasPermission(EnumSet.of(Permission.FullControl, Permission.Read)))
                        throw new AccessDeniedException(fileName(), null, "file is not readable");
                    break;
                case WRITE:
                    if (!hasPermission(EnumSet.of(Permission.FullControl, Permission.Write)))
                        throw new AccessDeniedException(fileName(), null, format("bucket '%s' is not writable", fileStoreName));
                    break;
            }
        }
    }

    private String fileName() {
        return fileStoreName + S3Path.PATH_SEPARATOR + key;
    }
}
