---
title: Rolling out MFA without angry staff
summary: How to announce MFA, help people register, and handle lost phones.
---
## Tell people before you flip the switch
Send a short heads-up a day or two before MFA starts: what is changing, why (stolen passwords are the number one way small businesses get hacked), what they need (their phone and five minutes), and who to ask for help. People push back less when it is not a surprise.

## Registration
At their next sign-in, users are prompted to install Microsoft Authenticator and scan a QR code. With Security Defaults they have 14 days before registration becomes required. Encourage everyone to finish on day one so they are not stuck later. Users can review their methods at mysignins.microsoft.com under Security info.

## Lost or replaced phones
Plan for this before it happens. An admin can require the user to register MFA again from the Entra admin center by opening the user, choosing Authentication methods, and selecting Require re-register multifactor authentication. Ask users to add a second method, such as a phone number, as a backup. Verify the person's identity by phone or in person before resetting anything, because attackers also call help desks pretending to be employees.

## Shared mailboxes and service accounts
Shared mailboxes in Microsoft 365 don't need their own sign-in, so users open them with their own MFA-protected account. Don't share one login between several people. If a device or app truly can't do MFA, talk to someone who can review the risk before making exceptions.
