---
title: Conditional Access for small teams
summary: What Conditional Access is, when it's worth it, and three starter policies.
---
## What Conditional Access does
Conditional Access is an if-this-then-that rule engine for sign-ins in Microsoft Entra ID. For example: if someone signs in to Microsoft 365, then require MFA; if a sign-in comes from a country you never work in, then block it. It needs Entra ID P1, which is included in Microsoft 365 Business Premium.

## When it's worth it
Security Defaults is enough for many small businesses. Conditional Access is worth it when you need exceptions (a shared front-desk PC), want to block legacy sign-ins while allowing a specific app, or want to require company-managed devices. It takes more care, because a bad policy can lock everyone out.

## Three starter policies
Microsoft offers ready-made templates under Entra ID, Conditional Access, Create new policy from templates. Good starting points are:
1. Require multifactor authentication for all users.
2. Require multifactor authentication for admins.
3. Block legacy authentication.
Create each one in Report-only mode first, watch the sign-in logs for a week, then switch it On.

## Don't lock yourself out
Keep one emergency access (break-glass) admin account excluded from your policies, with a long random password stored safely offline. Turn Security Defaults off only right before you switch your policies On, because the two can't be used together.
