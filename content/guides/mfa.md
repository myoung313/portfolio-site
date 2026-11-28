---
title: Turn on MFA for your whole team in 10 minutes
summary: The fastest free way to require multi-factor sign-in for every Microsoft 365 user.
---
## Why MFA matters
Most Microsoft 365 break-ins start with a stolen or guessed password. Multi-factor authentication (MFA) asks for a second proof, usually a tap in the Microsoft Authenticator app, so a stolen password alone is not enough. Microsoft reports that MFA blocks the vast majority of automated account attacks. If you only do one security task this year, make it this one.

## Option 1: Security Defaults (free, every plan)
Security Defaults is a free switch that turns on MFA for every user, requires MFA for admins every time they sign in, and blocks old sign-in methods (legacy authentication) that can't do MFA. It is included with every Microsoft 365 plan, so it is the best starting point for most small businesses.

To turn it on:
1. Sign in to entra.microsoft.com as a Global Administrator.
2. In the left menu open Entra ID (called Identity in some tenants), then Overview, then the Properties tab.
3. Select Manage security defaults.
4. Set Security defaults to Enabled and select Save.

Tenants created after October 2019 often have Security Defaults on already. Check before you change anything.

## Option 2: Conditional Access (Business Premium)
If you have Microsoft 365 Business Premium or Entra ID P1, Conditional Access policies give finer control, such as skipping the prompt on a trusted office network or requiring a compliant device. You must turn Security Defaults off before you can use Conditional Access, so build and test your policies first. See the Conditional Access for small teams guide.

## What your users will see
After MFA is turned on, each user is asked to register the Microsoft Authenticator app the next time they sign in. With Security Defaults they get 14 days to register before it becomes required. Tell your team a day ahead, share a short how-to, and keep a backup admin account so nobody gets locked out. The Rolling out MFA without angry staff guide has a message you can copy.
