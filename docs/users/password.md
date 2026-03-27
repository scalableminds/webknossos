# Account Settings

Users can manage their account settings by clicking on their user avatar in the top-right corner of the navigation bar and selecting `Account Settings`.

## Profile

The profile page allows users to manage their personal information and preferences.

### Name

Users can update their displayed username from the `Profile` tab within `Account Settings`.

1. Click the `edit` (pencil) icon next to your name.
2. Enter the new username and confirm the change.

### Email

Users can update their own email address from the `Profile` tab within `Account Settings`.

1. Click the `edit` (pencil) icon next to your email address.
2. Enter the new email address and confirm the change.

This email address will be used for all future notifications and for logging in.

### Organization & Role

Users can view their current **Organization** and **Role** (e.g., Administrator, Team Manager, User) from the `Profile` tab.
For more information about roles, see [Access rights and roles](access_rights.md).

### Theme

Users can customize the appearance of WEBKNOSSOS from the `Profile` tab.
The theme can be set to:
- **System Default**: Automatically matches your operating system's theme preference.
- **Light**: Forces a light-mode user interface.
- **Dark**: Forces a dark-mode user interface.

## Security

The security page allows users to manage their password and passkeys, as well as their active sessions.

### Password Reset

**Logged-in users** can _change_ their account password:

1. Navigate to the `Security` tab in `Account Settings`.
2. Click the `edit` (pencil) icon next to the `Password` field.
3. Provide your current password and choose a new one.

**Logged-out users** can _reset_ a forgotten password:

1. Click on `Forgot Password` on the login screen.
2. Provide your account's email address.
3. You will receive an email with instructions to reset your password.

### Log out everywhere

If you suspect unauthorized access or have lost a device, you can log out of all active sessions across all devices:

1. Navigate to the `Security` tab in `Account Settings`.
2. Click on the `Log out on all devices` button under `Log out everywhere`.
3. Confirm the prompt to log out. You will be redirected to the login screen.

### Passkeys

Passkeys are a new, more secure way to log in to websites and apps without using a password. Instead of typing a password, you use a fingerprint, face scan, or a device PIN to authenticate.

#### Adding and Removing Passkeys

Users can manage their passkeys from the `Security` tab in `Account Settings`.

1. To add a new passkey, press the `Register Passkey` button and give the passkey a name.
2. To delete a passkey, press the `Delete` button next to the passkey's name.

If you lose access to all your passkeys and cannot sign in, use the `Forgot Password` flow to recover your account.

## Developer Settings

### Authentication Token

This section is for managing a personal access token (API key) for programmatic access to WEBKNOSSOS.

This token is primarily used with the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) to automate tasks like uploading/downloading datasets, managing annotations, and integrating WEBKNOSSOS into custom analysis pipelines.

#### Token Revocation

If your token has been compromised or you suspect someone else has gained access to it, you can revoke it and generate a new one:

1. Navigate to the `Developer` group and select the `Auth Token` tab in `Account Settings`.
2. Click the `Revoke and Generate New Token` button.
3. This will invalidate the previous token and all sessions using it.

#### Organization ID

Certain API integrations need the organization ID which can be found her, in the developer settings.