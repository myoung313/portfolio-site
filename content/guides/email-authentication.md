---
title: SPF, DKIM and DMARC in plain English
summary: The three DNS records that stop people from sending email as your business.
---
## Why these records matter
Anyone can send an email that claims to be from your domain. SPF, DKIM and DMARC are DNS records that let receiving mail servers check whether an email really came from you. Without them, scammers can impersonate your business to your customers, and your real emails are more likely to land in spam. Google and Yahoo now require them for bulk senders.

## SPF
SPF (Sender Policy Framework) is a TXT record that lists which services may send email for your domain. For Microsoft 365 it usually looks like v=spf1 include:spf.protection.outlook.com -all. Add an include for every other service that sends as you, such as a newsletter tool. Only one SPF record is allowed per domain.

## DKIM
DKIM adds a digital signature to each email so receivers can tell it wasn't changed and really came from your domain. In Microsoft 365 you turn it on in the Microsoft Defender portal under Email and collaboration, Policies and rules, Threat policies, Email authentication settings, DKIM. Microsoft gives you two CNAME records to add at your DNS host, then you select Enable.

## DMARC
DMARC tells receivers what to do when an email fails SPF and DKIM checks, and sends you reports. Start with a TXT record at _dmarc.yourdomain.com such as v=DMARC1; p=none; rua=mailto:you@yourdomain.com to watch reports. Once all your real email passes, move to p=quarantine, then p=reject, which tells receivers to refuse fakes.

## Check your setup
The free CloudShift Labs Email checkup at cloudshiftlabs.net/checkup grades your SPF, DKIM and DMARC records and shows what to fix.
