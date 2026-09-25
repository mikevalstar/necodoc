---
type: feature
title: User preferences
description: A settings page where any signed-in user, pending or not, edits their name, changes their password, manages their sessions, picks a theme and deletes their account.
tags: [auth, app, product]
status: draft
generated: { by: okq/0.9.0, at: 2026-09-25T23:28:26Z }
---

# User preferences

## Summary

Every signed-in user has a Settings page for their own account: name,
password, sessions, theme, and account deletion. Admin-side account management
lives in [User management and roles](user-management-and-roles.md).

## Motivation

Without it, users depend on an admin for things they should do themselves:
fixing their name, rotating a password, signing out a lost device, or leaving.
Pending users need it too, since they can sign in but have no roles yet.

## Behavior

- **Where:** [settings.tsx](../../apps/app/src/routes/_app/settings.tsx),
  linked from the user menu in the [app shell](../../apps/app/src/routes/_app.tsx)
  and from the [pending page](../../apps/app/src/routes/pending.tsx). Pending
  users can open it; every other signed-in page still sends them to pending.
- **Profile:** edit your name. Email and roles are shown read-only.
  - Email is read-only because there is no email provider yet, so a new
    address can't be verified, and email is the sign-in identifier. Another
    admin can change it from Admin > Users (Edit details). Self-service email change
    comes with the email provider.
  - Roles are granted by admins only.
- **Change password:** current password, new password and confirmation, with
  an option to sign out your other devices.
- **Active sessions:** your signed-in sessions with browser, IP address, when
  each started and was last active, and which one is this device. Sign out any
  one of them, or all but this one.
- **Theme:** light, dark, or follow the system. Stored in this browser only
  (not on the account) and applied app-wide without a flash on load
  ([theme.ts](../../apps/app/src/lib/theme.ts), [index.html](../../apps/app/index.html)).
- **While impersonating:** an admin sees the user's profile and theme only.
  Password, sessions and account deletion are hidden: the password and account
  aren't the admin's to change, and the session list can't show the
  impersonation session.
- **Delete my account:** asks for your password, then confirms. Deletes the
  account and its sessions and signs you out
  ([auth.ts](../../apps/api/src/auth.ts)).
- **Last-admin guard:** the last active admin can't delete their own account.
  The API enforces it for every self-delete path, so a direct API call can't
  bypass it ([admin-guard.ts](../../apps/api/src/admin-guard.ts)). Any other
  admin can delete their own account.
- Form payloads come from [user.ts](../../packages/shared/src/user.ts).

## Acceptance criteria

- [ ] A pending user can reach Settings from the pending page and use it.
- [ ] Changing your name updates the user menu without a reload.
- [ ] Email and roles can't be changed from Settings.
- [ ] Changing the password requires the current one; "sign out other devices"
      ends every other session.
- [ ] The session list marks this device; revoking a session signs that
      device out.
- [ ] The theme choice survives a reload and "system" follows the OS setting.
- [ ] Deleting your account requires your password and signs you out.
- [ ] The API refuses to let the last active admin delete their own account.

## Known limitations

- Better Auth lets a session younger than a day delete its account without a
  password; the password prompt is the app's rule, not the API's. That includes
  an admin impersonating the user, who could delete that user from Admin >
  Users anyway.
- The last-admin guard checks, then deletes, without a lock (see
  [User management and roles](user-management-and-roles.md#known-limitations)).
- "Last active" is when Better Auth last refreshed the session, which happens
  about once a day, not the last request.

## Open questions

- **Self-service email change:** needs the email provider (see
  [User management and roles](user-management-and-roles.md#open-questions)).
- **Theme per account:** only if people ask for it across devices.
