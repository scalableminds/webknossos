# Testing Protocol: User Invites with Permissions and Team Roles

## Overview
This testing protocol covers the new feature that allows specifying user roles (Admin, Dataset Manager, Member) and team permissions (Team Manager, Member) when creating invites. It also ensures backward compatibility with the existing permissions and teams modal for editing existing users.

## Prerequisites
- Access to a WEBKNOSSOS instance with admin privileges
- Multiple test email addresses (or use email+tag@example.com variations)
- At least 2-3 teams created in the organization (including the "Default" team)
- Browser developer tools for debugging (if needed)

---

## Test Suite 1: Invite Creation with Permissions

### Test 1.1: Create Invite with Member Permission (Default)
**Objective**: Verify that invites can be created with the default "Member" permission.

**Steps**:
1. Log in as an admin user
2. Navigate to the user management page
3. Click "Invite Users" button
4. Enter a test email address (e.g., `testuser1+member@example.com`)
5. Verify that "Member" is selected by default under "Organization Permissions"
6. Verify that the "Default" team is selected by default under "Team Permissions" with "Member" role
7. Click "Send Invite Emails"
8. Verify success message appears

**Expected Results**:
- Invite is created successfully
- Email is sent to the recipient
- Default permission is "Member"
- Default team is pre-selected with "Member" role

---

### Test 1.2: Create Invite with Dataset Manager Permission
**Objective**: Verify that invites can be created with "Dataset Manager" permission.

**Steps**:
1. Log in as an admin user
2. Click "Invite Users"
3. Enter a test email address (e.g., `testuser2+datasetmanager@example.com`)
4. Select "Dataset Manager" under "Organization Permissions"
5. Select one or more teams with appropriate roles
6. Click "Send Invite Emails"
7. Verify success message appears

**Expected Results**:
- Invite is created with Dataset Manager permission
- Invitation email is sent
- Team selections are preserved

---

### Test 1.3: Create Invite with Admin Permission
**Objective**: Verify that invites can be created with "Admin" permission.

**Steps**:
1. Log in as an admin user
2. Click "Invite Users"
3. Enter a test email address (e.g., `testuser3+admin@example.com`)
4. Select "Admin" under "Organization Permissions"
5. Note that team selection becomes disabled (admins have access to all teams)
6. Click "Send Invite Emails"
7. Verify success message appears

**Expected Results**:
- Invite is created with Admin permission
- Team selection UI is disabled when Admin is selected
- Invitation email is sent successfully

---

### Test 1.4: Create Bulk Invites with Same Permissions
**Objective**: Verify that multiple invites can be created at once with the same permissions.

**Steps**:
1. Log in as an admin user
2. Click "Invite Users"
3. Enter multiple email addresses separated by commas, spaces, or newlines:
   ```
   bulkuser1@example.com
   bulkuser2@example.com, bulkuser3@example.com
   ```
4. Select "Dataset Manager" permission
5. Select 2 teams: "Default" as "Team Manager" and another team as "Member"
6. Click "Send Invite Emails"
7. Verify success message appears

**Expected Results**:
- All three invites are created successfully
- All invites have the same permission level (Dataset Manager)
- All invites have the same team assignments
- Three separate invitation emails are sent

---

## Test Suite 2: Using Invites to Join Organization

### Test 2.1: Register with Member Invite
**Objective**: Verify that a new user registering via an invite receives the correct Member permissions.

**Steps**:
1. Create an invite with "Member" permission and "Default" team (Member role)
2. Open the invite link in an incognito/private browser window
3. Complete the registration form
4. Log in with the new account
5. Navigate to the user profile or dashboard
6. Check user permissions and team memberships

**Expected Results**:
- User is registered successfully
- User has "Member" permission (no admin or dataset manager rights)
- User is member of the "Default" team with "Member" role
- User cannot access admin features
- User can only see datasets shared with their teams

---

### Test 2.2: Register with Dataset Manager Invite
**Objective**: Verify that a new user registering via an invite receives Dataset Manager permissions.

**Steps**:
1. Create an invite with "Dataset Manager" permission and 2 teams
2. Open the invite link in an incognito/private browser window
3. Complete the registration form
4. Log in with the new account
5. Navigate to the dataset list
6. Attempt to create/edit datasets
7. Attempt to access admin settings (should fail)

**Expected Results**:
- User has Dataset Manager permission
- User can view and edit all datasets
- User is member of the specified teams
- User cannot access admin settings
- User cannot manage users or organization settings

---

### Test 2.3: Register with Admin Invite
**Objective**: Verify that a new user registering via an invite receives Admin permissions.

**Steps**:
1. Create an invite with "Admin" permission
2. Open the invite link in an incognito/private browser window
3. Complete the registration form
4. Log in with the new account
5. Navigate to the admin settings
6. Verify access to user management, organization settings, etc.

**Expected Results**:
- User has Admin permission
- User can access all admin features
- User can view and edit all datasets
- User can manage other users and teams
- User has full organization administration capabilities

---

### Test 2.4: Join Organization with Team Manager Role
**Objective**: Verify that users can be invited as Team Managers for specific teams.

**Steps**:
1. Create a new team called "Test Team"
2. Create an invite with "Member" organization permission
3. Select "Test Team" and set role to "Team Manager"
4. Also select "Default" team with "Member" role
5. Open the invite link and complete registration
6. Log in with the new account
7. Navigate to the team management section
8. Verify team manager capabilities for "Test Team"

**Expected Results**:
- User is Team Manager of "Test Team"
- User is regular Member of "Default" team
- User can manage members within "Test Team"
- User cannot manage members in "Default" team
- User doesn't have organization-wide admin rights

---

### Test 2.5: Existing User Joins via Invite
**Objective**: Verify that an existing user from another organization can join via invite.

**Steps**:
1. Have an existing user account in a different organization
2. Create an invite in your organization with specific permissions and teams
3. Use the invite link while logged in as the existing user
4. Accept the invitation to join the organization
5. Switch to the new organization
6. Verify permissions and team memberships

**Expected Results**:
- Existing user successfully joins the new organization
- User receives the permissions specified in the invite
- User is added to the teams specified in the invite
- User can switch between organizations
- Original organization membership is preserved

---

## Test Suite 3: Permissions and Teams Modal (Existing Functionality)

### Test 3.1: Edit Single User's Permissions
**Objective**: Verify that the existing permissions modal still works correctly for editing users.

**Steps**:
1. Log in as an admin user
2. Navigate to the user list
3. Select a single existing user
4. Click "Edit Permissions & Teams" button
5. Change the organization permission (e.g., Member → Dataset Manager)
6. Modify team memberships
7. Click "Set Teams & Permissions"
8. Verify confirmation dialog appears (if permission changed)
9. Confirm the change

**Expected Results**:
- Modal opens correctly with current user's permissions pre-selected
- Permission radio buttons work correctly
- Team checkboxes and role toggles work correctly
- Changes are saved successfully
- User permissions are updated in the database
- User's next login reflects the new permissions

---

### Test 3.2: Edit Multiple Users' Teams
**Objective**: Verify that team memberships can be updated for multiple users at once.

**Steps**:
1. Log in as an admin user
2. Navigate to the user list
3. Select multiple users (2-3 users)
4. Click "Edit Permissions & Teams"
5. Note that permission editing is disabled for bulk operations
6. Add/remove team memberships
7. Change team roles (Member ↔ Team Manager)
8. Click "Set Teams & Permissions"

**Expected Results**:
- Modal shows message: "Team memberships will be updated for all selected users"
- Organization permission selection is disabled
- Team selections apply to all selected users
- Changes are saved successfully for all users

---

### Test 3.3: Admin Changes User to Admin
**Objective**: Verify that promoting a user to admin shows a confirmation dialog.

**Steps**:
1. Log in as an admin user
2. Select a single user with "Member" permission
3. Click "Edit Permissions & Teams"
4. Select "Admin" permission
5. Click "Set Teams & Permissions"
6. Verify confirmation dialog appears with appropriate warning message
7. Confirm the change
8. Verify the user is now an admin

**Expected Results**:
- Confirmation dialog appears with message about granting admin rights
- User is promoted to admin after confirmation
- Team selection becomes disabled (grayed out)
- User can now access admin features

---

### Test 3.4: Admin Revokes Admin Rights
**Objective**: Verify that demoting an admin user shows a confirmation dialog.

**Steps**:
1. Log in as an admin user
2. Select a single user who is currently an admin
3. Click "Edit Permissions & Teams"
4. Select "Member" permission
5. Add appropriate teams (as they will need team access now)
6. Click "Set Teams & Permissions"
7. Verify confirmation dialog appears
8. Confirm the change

**Expected Results**:
- Confirmation dialog appears with message about revoking admin rights
- Team selection becomes enabled when changing from Admin
- User is demoted successfully
- User loses admin access immediately

---

### Test 3.5: Team Manager Role Assignment
**Objective**: Verify that existing users can be made team managers.

**Steps**:
1. Log in as an admin user
2. Select a single user
3. Click "Edit Permissions & Teams"
4. Check a team checkbox to add the user
5. Select "Team Manager" role for that team
6. Click "Set Teams & Permissions"

**Expected Results**:
- Team manager role is assigned correctly
- User can now manage members of that specific team
- User cannot manage other teams (unless also team manager there)

---

## Test Suite 4: Edge Cases and Validation

### Test 4.1: Non-Admin Cannot Send Admin Invites
**Objective**: Verify that non-admin users cannot create invites with elevated permissions.

**Steps**:
1. Log in as a non-admin user (Team Manager or regular Member)
2. Navigate to invite creation (if available)
3. Attempt to select "Admin" or "Dataset Manager" permissions
4. Attempt to send the invite

**Expected Results**:
- Admin and Dataset Manager options should be disabled
- OR invite creation should fail with appropriate error message
- Non-admin users can only invite with "Member" permission

---

### Test 4.2: Team Manager Can Only Invite to Managed Teams
**Objective**: Verify that team managers can only add invites to teams they manage.

**Steps**:
1. Create a user who is Team Manager of "Team A" but not "Team B"
2. Log in as that user
3. Try to create an invite
4. Attempt to assign the invite to "Team B"

**Expected Results**:
- User can only select teams they manage
- OR invite creation fails with error about insufficient permissions
- Backend validation prevents unauthorized team assignments

---

### Test 4.3: Invalid Email Addresses
**Objective**: Verify proper validation of email addresses in invite creation.

**Steps**:
1. Log in as an admin user
2. Click "Invite Users"
3. Enter invalid email addresses:
   - No @ symbol: `invalidemail`
   - Missing domain: `user@`
   - Just text: `not an email`
4. Try to send invites

**Expected Results**:
- Frontend validation shows error for invalid emails
- OR backend rejects invalid emails with clear error message
- Valid emails are processed, invalid ones are skipped or rejected

---

### Test 4.4: Duplicate Email Invitation
**Objective**: Verify behavior when inviting an already-invited or existing user.

**Steps**:
1. Create an invite for `duplicate@example.com`
2. Try to create another invite for the same email
3. Try to invite an email that already has a registered user

**Expected Results**:
- System either prevents duplicate invites with appropriate message
- OR creates a new invite token that supersedes the old one
- Clear error message when trying to invite existing users

---

### Test 4.5: Expired Invite Link
**Objective**: Verify that expired invites cannot be used.

**Steps**:
1. Create an invite (if possible, modify database to expire it immediately)
2. Try to use the expired invite link
3. Attempt to register

**Expected Results**:
- Clear error message about expired invite
- Registration is blocked
- User is directed to request a new invite or contact admin

---

### Test 4.6: Admin Selection Disables Teams
**Objective**: Verify that selecting Admin permission disables team selection.

**Steps**:
1. Open invite creation modal
2. Select some teams
3. Change organization permission to "Admin"
4. Verify team checkboxes become disabled
5. Change back to "Member" or "Dataset Manager"
6. Verify team selection becomes enabled again

**Expected Results**:
- Team selection is disabled when Admin is selected
- Previously selected teams are cleared or ignored
- Team selection is re-enabled when changing away from Admin
- UI clearly indicates that admins have access to all teams

---

## Test Suite 5: UI/UX Verification

### Test 5.1: Modal Layout and Styling
**Objective**: Verify that the invite modal is well-structured and readable.

**Steps**:
1. Open the invite creation modal
2. Check the visual layout:
   - Dividers between sections
   - Clear subtitles for each section
   - Proper spacing and alignment
   - Radio buttons for permissions
   - Checkboxes for teams
   - Radio buttons for team roles
3. Verify tooltips and help icons work

**Expected Results**:
- Modal is visually organized with clear sections
- Subtitles use bold h5 headers with dividers
- "Organization Permissions" section with info icon link to docs
- "Team Permissions" section with Teams and Role columns
- All interactive elements are properly styled
- Help documentation is accessible via info icon

---

### Test 5.2: Responsive Design
**Objective**: Verify that modals work on different screen sizes.

**Steps**:
1. Open invite modal on desktop resolution
2. Resize browser window to tablet size
3. Resize to mobile size
4. Verify all elements remain accessible and functional

**Expected Results**:
- Modal adapts to different screen sizes
- All form elements remain accessible
- No horizontal scrolling required
- Text remains readable
- Buttons are properly sized and positioned

---

### Test 5.3: Default Team Pre-selection
**Objective**: Verify that the "Default" team is automatically selected in invite modal.

**Steps**:
1. Open the invite creation modal
2. Check the team selection section
3. Verify "Default" team is pre-checked

**Expected Results**:
- "Default" team checkbox is checked by default
- Role is set to "Member" for the default team
- User can uncheck it if needed
- Console log shows "Setting default team in invite modal"

---

### Test 5.4: Role Selection Interaction
**Objective**: Verify that team role selection works correctly.

**Steps**:
1. Open invite modal
2. Uncheck all teams
3. Try to select a role (should be disabled)
4. Check a team
5. Select "Team Manager" role
6. Select "Member" role
7. Uncheck the team
8. Verify role selection is disabled again

**Expected Results**:
- Role buttons are disabled when team is not selected
- Role buttons become enabled when team is checked
- Only one role can be selected at a time (radio button behavior)
- Role selection persists when checking/unchecking other teams

---

## Test Suite 6: Backend Integration and Database

### Test 6.1: Database Schema Verification
**Objective**: Verify that invite data is correctly stored in the database.

**Steps**:
1. Create an invite with specific permissions and teams
2. Query the database to check the `invites` table
3. Verify the following fields are correctly stored:
   - `isAdmin`
   - `isDatasetManager`
4. Query the `invite_team_roles` table
5. Verify team memberships are stored with correct `isTeamManager` flags

**Expected Results**:
- Invite record contains correct `isAdmin` and `isDatasetManager` values
- Join table `invite_team_roles` contains correct team IDs and roles
- Foreign key constraints are properly maintained
- Data integrity is preserved

---

### Test 6.2: User Creation from Invite
**Objective**: Verify that user records are correctly created from invite data.

**Steps**:
1. Create an invite with specific permissions and teams
2. Use the invite to register a new user
3. Query the `users` table for the new user
4. Verify:
   - `isAdmin` matches invite
   - `isDatasetManager` matches invite
5. Query `user_team_roles` for the new user
6. Verify team memberships match invite specification

**Expected Results**:
- User record has correct permission flags
- User has correct team memberships
- Team roles (isTeamManager) are correctly assigned
- Default organization team is included even if not in invite

---

## Test Suite 7: Security and Authorization

### Test 7.1: Permission Escalation Prevention
**Objective**: Verify that users cannot escalate their own permissions via invites.

**Steps**:
1. Log in as a non-admin user
2. Try to create an invite (if accessible)
3. Try to set Admin or Dataset Manager permissions
4. Observe any error messages or restrictions

**Expected Results**:
- Non-admin users cannot create invites with elevated permissions
- Backend validates and rejects unauthorized permission grants
- Clear error message is shown

---

### Test 7.2: Cross-Organization Invite Prevention
**Objective**: Verify that invites are organization-specific.

**Steps**:
1. Create an invite in Organization A
2. Try to use the invite link while in Organization B context
3. Try to manipulate invite parameters to join wrong organization

**Expected Results**:
- Invites only work for the intended organization
- Backend validates organization context
- Appropriate error messages for cross-organization attempts

---

## Test Suite 8: Regression Testing

### Test 8.1: Existing Users Not Affected
**Objective**: Verify that existing users' permissions remain unchanged.

**Steps**:
1. Document current permissions and teams for several existing users
2. Deploy the new feature
3. Verify that existing users still have the same permissions
4. Verify existing team memberships are unchanged

**Expected Results**:
- No existing user permissions are modified
- No existing team memberships are altered
- Migration scripts preserve all existing data
- Users can continue working without interruption

---

### Test 8.2: Old Invites Still Work
**Objective**: Verify that invites created before the feature update still function.

**Steps**:
1. If possible, create an invite using the old system (before deploying)
2. Deploy the new feature
3. Try to use the old invite link
4. Complete registration

**Expected Results**:
- Old invites still work (backward compatibility)
- Users get default permissions if invite lacks new fields
- No errors during registration process
- Graceful handling of missing permission fields

---

## Test Suite 9: Error Handling and Recovery

### Test 9.1: Network Errors During Invite Creation
**Objective**: Verify graceful handling of network issues.

**Steps**:
1. Open developer tools and throttle network
2. Try to create an invite
3. Simulate network disconnection
4. Verify error handling

**Expected Results**:
- Loading indicators show during API calls
- Timeout errors are caught and displayed
- User-friendly error messages
- Modal remains open so user can retry

---

### Test 9.2: Partial Team Membership Failure
**Objective**: Verify handling when some team assignments fail.

**Steps**:
1. Create an invite with multiple teams
2. If possible, simulate a scenario where one team assignment fails
3. Observe error handling

**Expected Results**:
- Transaction rollback if any team assignment fails (all-or-nothing)
- OR clear error message indicating which teams succeeded/failed
- Data consistency is maintained

---

## Summary Checklist

Use this checklist to track overall testing progress:

### Invite Creation
- [ ] Member permission invites work
- [ ] Dataset Manager permission invites work
- [ ] Admin permission invites work
- [ ] Bulk invites work correctly
- [ ] Default team is pre-selected
- [ ] UI properly shows and validates all fields

### Using Invites
- [ ] New users get correct Member permissions
- [ ] New users get correct Dataset Manager permissions
- [ ] New users get correct Admin permissions
- [ ] Team Manager roles are correctly assigned
- [ ] Existing users can join via invite
- [ ] Team memberships from invite are applied

### Existing Modal Functionality
- [ ] Single user permission editing works
- [ ] Bulk user team editing works
- [ ] Admin promotion shows confirmation
- [ ] Admin demotion shows confirmation
- [ ] Team Manager role assignment works
- [ ] UI remains consistent and functional

### Edge Cases
- [ ] Non-admin permission restrictions work
- [ ] Team Manager can only invite to managed teams
- [ ] Email validation works correctly
- [ ] Duplicate invite handling works
- [ ] Expired invites are rejected
- [ ] Admin selection disables teams correctly

### UI/UX
- [ ] Modal layout is clear and organized
- [ ] Responsive design works on all screen sizes
- [ ] Default team pre-selection works
- [ ] Role selection interactions work smoothly

### Security
- [ ] Permission escalation is prevented
- [ ] Cross-organization invites are blocked
- [ ] Authorization is properly enforced

### Regression
- [ ] Existing users are not affected
- [ ] Old invites still work (if applicable)
- [ ] Database migrations completed successfully

### Error Handling
- [ ] Network errors are handled gracefully
- [ ] Partial failures are handled correctly
- [ ] All error messages are user-friendly

---

## Notes for Testers

- **Test Environment**: Use a development or staging instance, not production
- **Test Data**: Create test users and teams that can be safely modified or deleted
- **Browser Compatibility**: Test on Chrome, Firefox, Safari, and Edge
- **Documentation**: Note any issues, bugs, or unexpected behavior
- **Screenshots**: Capture screenshots of any issues for bug reports
- **Performance**: Note any slow operations or UI lag
- **Accessibility**: Verify keyboard navigation and screen reader compatibility where applicable

## Bug Report Template

If issues are found, use this template:

**Test Case**: [Test number and name]  
**Steps to Reproduce**: [Detailed steps]  
**Expected Result**: [What should happen]  
**Actual Result**: [What actually happened]  
**Screenshots**: [Attach screenshots if applicable]  
**Browser/Environment**: [Browser version, OS, etc.]  
**Severity**: [Critical/High/Medium/Low]  
**Additional Notes**: [Any other relevant information]
