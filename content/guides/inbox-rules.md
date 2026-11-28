---
title: Find suspicious inbox rules and forwarding
summary: Attackers hide in mailboxes with forwarding and delete rules. Here's how to check.
---
## Why attackers create inbox rules
After breaking into a mailbox, attackers often add a rule that forwards copies of email outside the company or moves replies to an obscure folder, so they can keep watching and hide their tracks even after the password is changed.

## Check one mailbox
In Outlook on the web, open Settings, Mail, Rules, and look for rules you don't recognize, especially ones that forward, redirect, delete, or move mail to folders like RSS Feeds or Archive. Also check Settings, Mail, Forwarding.

## Block forwarding to outside addresses
Microsoft 365 blocks automatic forwarding to external addresses by default through the outbound spam filter policy. Confirm it in the Microsoft Defender portal under Email and collaboration, Policies and rules, Threat policies, Anti-spam, Anti-spam outbound policy, where Automatic forwarding rules should be set to Automatic (system-controlled) or Off.

## Alerts
Microsoft Defender raises alerts for suspicious forwarding and inbox rule activity. Make sure an admin actually receives and reads alert emails, which you can set up under Settings, Email notifications in the Defender portal.
