---
title: Backups that actually save you from ransomware
summary: Is Microsoft 365 backed up? The 3-2-1 rule, and testing restores.
---
## Is Microsoft 365 already backed up?
Microsoft keeps your data available and protects it from hardware failures, and deleted items can be recovered for a limited time (often 14 to 93 days depending on the item). That is not the same as a backup you control. If an attacker or a mistake deletes or encrypts data and nobody notices in time, it can be gone. Microsoft 365 Backup and third-party backup tools fill that gap.

## The 3-2-1 rule
Keep 3 copies of important data, on 2 different types of storage, with 1 copy offsite or offline. A modern twist is 3-2-1-1-0: one copy immutable (can't be changed or deleted, even by an admin) and zero errors when you test restores.

## Protect the backups themselves
Ransomware groups look for backups and delete them first. Use separate credentials with MFA for your backup system, turn on immutability or soft-delete if the product supports it, and don't leave backup drives permanently plugged into the computer they protect.

## Test your restores
A backup you have never restored from is a guess. A few times a year, restore a real file and a full mailbox or folder and time how long it takes. Write the steps down so someone else could do it during a stressful day.
