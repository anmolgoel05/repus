# Abuse response and report retention

## Ownership

The production operator must designate a primary and backup abuse-response owner before enabling live sending. The primary owner must be a verified address in `PLATFORM_ADMIN_EMAILS`; the backup must have access to the same production runbook and escalation channel. The primary reviews new reports every business day and confirms coverage during absences. The platform operator remains accountable for workspace suspension and the global sending pause.

## Response targets

- Review ordinary reports within one business day and set the status to `in_review` while investigating.
- For credible phishing, credential theft, or a report indicating active widespread abuse, begin triage immediately and within one hour. Suspend the affected workspace or pause sending while gathering evidence when continued sending could cause harm.
- Record the outcome by setting the report to `resolved` or `rejected`. If a reporter supplied a contact address, the abuse owner may follow up through the approved incident channel.
- Review unresolved `open` and `in_review` reports at least weekly. Escalate overdue cases to the platform operations owner.

Use the admin dashboard's Abuse reports panel to view submissions and change status. Status changes are written to the platform audit log. Keep investigation notes and provider evidence in the organization's approved incident system; do not copy sensitive message content into general application logs.

## Report data retention

Abuse reports contain sender addresses, optional reporter addresses, message references, and free-form details. Access is limited to allowlisted platform administrators. Public submission is rate-limited and can insert reports but cannot read or modify existing reports.

Resolved and rejected reports are retained for 365 days after their last status change, then removed by the trusted worker's daily cleanup. Open and in-review reports are retained until resolved or rejected; owners must review unresolved cases weekly so they do not become indefinite by neglect. The cleanup logs only the number of deleted reports, never report contents or addresses. Database backups follow the separate backup retention policy in the deployment plan.

## Operational monitoring

Check the admin health dashboard at the start of each on-call shift and after a delivery incident. The SES CloudFormation stack can notify an on-call email when the provider-event queue's oldest message exceeds five minutes, an event reaches the DLQ, or SES account bounce/complaint reputation rates cross configured thresholds; confirm the SNS subscription after deployment. In production, the worker emits aggregate BullMQ failed-job, queue-check, and heartbeat metrics, and the API emits an aggregate 5xx metric. The stack alarms when terminal failures exceed 10, queue checks fail, the worker heartbeat is missing for five minutes, or the API emits a server error. Alert the designated primary and backup through the production incident channel. Acknowledge an operational alert within 15 minutes; for a widespread send failure, use the global sending pause until event processing and provider health recover.

These thresholds are initial operating defaults. Review them after the first month of real traffic and adjust to measured queue volume and SES reputation guidance. The app exposes current health and event lag. Before live sending, ship API and worker stdout/stderr to CloudWatch Logs so Embedded Metric Format records are extracted, deploy the CloudFormation stack, confirm the email subscription, and trigger a controlled alert test. Alert delivery and escalation routing remain deployment tasks until these steps are verified.
