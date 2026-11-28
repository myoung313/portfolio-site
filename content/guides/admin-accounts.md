---
title: Protect your admin accounts
summary: Fewer admins, separate admin logins, and an emergency account.
---
## Keep admins to a minimum
Global Administrator can change anything in your tenant, so every extra admin is extra risk. Aim for two to four Global Administrators. Give people narrower roles where possible, such as User Administrator, Exchange Administrator or Billing Administrator.

## Use a separate admin account
Admins should do daily email and web browsing with a normal account and sign in with a separate admin account (for example admin-jane@yourdomain.com) only for admin work. Admin accounts don't need a mailbox license. That way a phishing email that tricks you during the day can't hand over admin rights.

## Emergency access account
Keep one cloud-only emergency access (break-glass) account with Global Administrator, a long random password stored offline, and strong MFA such as a FIDO2 security key. Exclude it from Conditional Access policies that could lock you out, and check its sign-ins regularly.

## Review regularly
Every few months, review who holds admin roles in the Microsoft 365 admin center under Roles, Role assignments, and remove anyone who no longer needs them, including former staff and outside IT providers.
