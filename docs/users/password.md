# Account Settings

Users can manage their account settings by clicking on their user avatar in the top-right corner of the navigation bar and selecting `Account Settings`.

## Profile

The profile page allows users to manage their personal information.

### Change Account Email

A user can update their own email address from the `Profile` tab within `Account Settings`.
1. Click the `edit` (pencil) icon next to your email address.
2. Enter the new email address and confirm the change.

This email address will be used for all future notifications and for logging in.

## Security

The security page allows users to manage their password and passkeys.

### Password Reset

**Logged-in users** can _change_ their account password:
1. Navigate to the `Security` tab in `Account Settings`.
2. Click the `edit` icon next to the `Password` field.
3. Provide your current password and choose a new one.

**Logged-out users** can _reset_ a forgotten password:
1. Click on `Forgot Password` on the login screen.
2. Provide your account's email address.
3. You will receive an email with instructions to reset your password.

### Passkeys

Passkeys are a new, more secure way to log in to websites and apps without using a password. Instead of typing a password, you use a fingerprint, face scan, or a device PIN to authenticate.

#### Adding and Removing Passkeys

Users can manage their passkeys from the `Security` tab in `Account Settings`.

1.  Click the `edit` icon next to the `Password` field to open the security management page.
2.  To add a new passkey, press the `Register Passkey` button and give the passkey a name.
3.  To delete a passkey, press the `Delete` button next to the passkey's name.

If you lose access to all your passkeys and cannot sign in, use the `Forgot Password` flow to recover your account.

## Developer Settings

### Authentication Token

This section is for generating a personal access token (API key) for programmatic access to WEBKNOSSOS.

This token is primarily used with the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py/) to automate tasks like uploading/downloading datasets, managing annotations, and integrating WEBKNOSSOS into custom analysis pipelines.
