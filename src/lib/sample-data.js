// "Northwind Pay" — a fictional fintech's last two years of delivery history.
// Loaded on demand from the Hindsight project page so judges (or new customers)
// can see real forecasts on an empty site. Every item is clearly labelled as sample data.
//
// Dates are relative (monthsAgo) and stored in the `hindsight-history` issue property,
// because Jira does not allow back-dating created/resolved timestamps.

export const SAMPLE_LABEL = 'hindsight-sample';

export const SAMPLE_EPICS = [
  {
    summary: 'Migrate subscription billing to Stripe Billing API',
    description:
      'Move recurring subscription charges from our in-house scheduler to Stripe Billing. Includes webhook handling for invoice.paid / payment_failed, proration, and dunning emails. Cutover for 42k active subscribers.',
    monthsAgo: 14, plannedDays: 42, slipDays: 28, owner: 'Sofia Alvarez',
    children: [
      { kind: 'task', summary: 'Implement Stripe webhook consumer for invoice events' },
      { kind: 'task', summary: 'Proration logic parity tests' },
      { kind: 'bug', summary: 'Proration off by one day for annual plans' },
      { kind: 'incident', severity: 'Sev-2', fixer: 'Priya Nair', summary: 'Duplicate charges after webhook retries during cutover (1,140 customers)' },
    ],
    retro:
      'Retro: We did not load-test webhook retries, and Stripe retried aggressively during cutover which caused duplicate charges. Next time we must add idempotency keys before go-live and load-test webhook retries at 10x volume. Finance found out about the cutover date two days before; involve Finance before scheduling any billing cutover.',
  },
  {
    summary: 'PayPal checkout integration for EU markets',
    description:
      'Add PayPal as a payment method at checkout for DE, FR, NL, ES. Multi-currency support (EUR, GBP, PLN), refunds through PayPal API, payment status reconciliation.',
    monthsAgo: 19, plannedDays: 35, slipDays: 12, owner: 'Daniel Kim',
    children: [
      { kind: 'task', summary: 'PayPal Orders API integration' },
      { kind: 'bug', summary: 'Currency rounding error for PLN totals' },
      { kind: 'bug', summary: 'JPY treated as 2-decimal currency in reconciliation' },
      { kind: 'bug', summary: 'Refund amount rounding mismatch vs PayPal' },
      { kind: 'bug', summary: 'Rounding difference in multi-item basket tax' },
    ],
    retro:
      'Lessons learned: almost all of the slip came from currency rounding bugs found late in QA. We should build a currency test matrix (zero-decimal and three-decimal currencies) before writing integration code. Always reconcile amounts in minor units.',
  },
  {
    summary: 'Refunds v2: partial refunds and refund-to-wallet',
    description:
      'Allow support agents to issue partial refunds and refund to store wallet. Touches payments ledger, Stripe refund API and support console.',
    monthsAgo: 9, plannedDays: 28, slipDays: -2, owner: 'Priya Nair',
    children: [
      { kind: 'task', summary: 'Write refund test plan with Finance sign-off' },
      { kind: 'task', summary: 'Ledger entries for partial refunds' },
      { kind: 'task', summary: 'Feature flag rollout to 5% / 50% / 100%' },
    ],
    retro:
      'Retro: Shipped two days early. What worked: we wrote the test plan with Finance before any code, and rolled out behind a feature flag. Next time keep doing a staged rollout for anything that moves money.',
  },
  {
    summary: 'Move invoice tax calculation to new tax engine',
    description:
      'Replace hand-written VAT rules with Avalara-style tax engine for invoices and subscriptions. EU OSS rules, US sales tax nexus, credit notes.',
    monthsAgo: 11, plannedDays: 30, slipDays: 20, owner: 'Arjun Mehta',
    children: [
      { kind: 'task', summary: 'Tax engine client and caching' },
      { kind: 'task', summary: 'Backfill tax codes for 3,000 SKUs' },
      { kind: 'incident', severity: 'Sev-1', fixer: 'Arjun Mehta', summary: 'EU invoices issued with 0% VAT for 6 hours after launch' },
    ],
    retro:
      'Postmortem: launch went straight to 100% with no shadow mode, so the 0% VAT bug hit real invoices. We should run new money calculations in shadow mode against production traffic for at least a week. Involve Finance and Legal before launch, not after.',
  },
  {
    summary: 'Apple Pay and Google Pay wallets at checkout',
    description:
      'Add Apple Pay and Google Pay buttons to web and mobile checkout using Stripe Payment Request. Merchant domain verification and certificates.',
    monthsAgo: 6, plannedDays: 21, slipDays: 15, owner: 'Wei Chen',
    children: [
      { kind: 'task', summary: 'Payment Request button on web checkout' },
      { kind: 'task', summary: 'Apple merchant domain verification' },
      { kind: 'incident', severity: 'Sev-2', fixer: 'Wei Chen', summary: 'Apple Pay failing in production: merchant identity certificate expired' },
    ],
    retro:
      'Retro: sandbox behaved differently from production. Lessons: track certificate expiry dates in a calendar with owners, and test with real devices in production before announcing.',
  },
  {
    summary: 'OAuth2 migration for public partner API',
    description:
      'Replace static API keys for partners with OAuth2 client credentials. Token rotation, scopes, developer portal docs. 180 partner integrations affected.',
    monthsAgo: 16, plannedDays: 45, slipDays: 35, owner: 'Liam O\'Connor',
    children: [
      { kind: 'task', summary: 'Authorization server and token endpoint' },
      { kind: 'task', summary: 'Partner migration guide' },
      { kind: 'incident', severity: 'Sev-2', fixer: 'Fatima Khan', summary: 'Partner integrations broke when old API keys were revoked early' },
    ],
    retro:
      'Retro: partners were notified only one week before keys were revoked. Next time we need 30 days notice, a dual-run period where both API keys and OAuth work, and a usage dashboard to see who has not migrated.',
  },
  {
    summary: 'SSO with Okta and Azure AD (SAML)',
    description: 'Enterprise single sign-on via SAML 2.0 for Okta and Azure AD. Just-in-time provisioning, admin settings page.',
    monthsAgo: 12, plannedDays: 30, slipDays: 1, owner: 'Fatima Khan',
    children: [
      { kind: 'task', summary: 'SAML assertion consumer service' },
      { kind: 'task', summary: 'JIT user provisioning' },
      { kind: 'bug', summary: 'Clock skew rejects valid SAML assertions' },
    ],
    retro: 'Retro: went smoothly because we tested against real Okta and Azure tenants from week one. Always allow clock skew tolerance in SAML validation.',
  },
  {
    summary: 'Upgrade primary Postgres cluster from 14 to 16',
    description: 'Major version upgrade of the payments database cluster using logical replication. Zero-downtime target.',
    monthsAgo: 8, plannedDays: 14, slipDays: 6, owner: 'Emma Brooks',
    children: [
      { kind: 'task', summary: 'Logical replication setup to PG16 replica' },
      { kind: 'incident', severity: 'Sev-3', fixer: 'Emma Brooks', summary: 'Replication lag spiked to 40 minutes during backfill' },
    ],
    retro: 'Lessons learned: rehearse the full upgrade on a production-sized snapshot first. We should throttle backfills during business hours.',
  },
  {
    summary: 'Kafka event bus for order and payment events',
    description: 'Publish order and payment lifecycle events to Kafka so downstream teams stop polling the payments DB. Schema registry, consumer SDK.',
    monthsAgo: 13, plannedDays: 40, slipDays: 25, owner: 'Daniel Kim',
    children: [
      { kind: 'task', summary: 'Schema registry and Avro schemas' },
      { kind: 'task', summary: 'Outbox pattern in payments service' },
      { kind: 'incident', severity: 'Sev-2', fixer: 'Priya Nair', summary: 'Consumer lag caused payment confirmation emails to be 3 hours late' },
      { kind: 'bug', summary: 'Duplicate events after consumer rebalance' },
    ],
    retro: 'Retro: consumers must be idempotent from day one; we assumed exactly-once and were wrong. Next time define lag alerts before launch.',
  },
  {
    summary: 'Checkout page redesign',
    description: 'New single-page checkout with address autocomplete and saved cards. A/B tested against the old flow.',
    monthsAgo: 7, plannedDays: 30, slipDays: 0, owner: 'Sofia Alvarez',
    children: [
      { kind: 'task', summary: 'A/B test setup' },
      { kind: 'task', summary: 'Address autocomplete' },
    ],
    retro: 'Retro: shipped on time. The A/B test plan agreed with Product up front avoided scope creep. Keep doing that.',
  },
  {
    summary: 'Fraud scoring rules engine',
    description: 'Real-time fraud scoring on card payments with configurable rules and manual review queue.',
    monthsAgo: 10, plannedDays: 35, slipDays: 9, owner: 'Arjun Mehta',
    children: [
      { kind: 'task', summary: 'Rules DSL and evaluator' },
      { kind: 'bug', summary: 'False positives blocked 2% of legitimate payments' },
    ],
    retro: 'Retro: we should have run the rules in shadow mode before blocking payments. Involve Support before launch so they can handle the review queue.',
  },
  {
    summary: 'Mobile app offline mode',
    description: 'Let users browse orders and receipts offline in the iOS and Android apps. Local cache and sync.',
    monthsAgo: 5, plannedDays: 30, slipDays: 18, owner: 'Wei Chen',
    children: [
      { kind: 'task', summary: 'Local SQLite cache' },
      { kind: 'bug', summary: 'Sync conflict overwrites newer server data' },
      { kind: 'bug', summary: 'Receipts missing after airplane mode toggle' },
    ],
    retro: 'Retro: we underestimated sync conflict handling. Next time prototype conflict resolution in week one before building UI.',
  },
];

export function sampleHistory(e, now = Date.now()) {
  const DAY = 86400000;
  const start = now - e.monthsAgo * 30 * DAY;
  const due = start + e.plannedDays * DAY;
  const resolved = due + e.slipDays * DAY;
  return {
    imported: true,
    source: 'Sample data: Northwind Pay',
    owner: e.owner,
    startedAt: new Date(start).toISOString(),
    dueAt: new Date(due).toISOString(),
    resolvedAt: new Date(resolved).toISOString(),
  };
}
