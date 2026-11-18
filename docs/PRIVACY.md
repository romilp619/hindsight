# Hindsight — Privacy Policy

_Last updated: 18 November 2026_

Hindsight is an Atlassian Forge app for Jira that runs evidence-based pre-mortems for new work,
using how similar past work in the same Jira site actually went.

## What data Hindsight processes

- **Jira work item data** on the site where it is installed: summaries, descriptions, statuses,
  dates, labels, comments, child work items and issue properties of finished epics and of the
  work item being forecast.
- **Atlassian account references**: the account ID and display name of people who led or fixed
  similar past work, shown as "people who've done this before".

## Where data is stored and processed

- Hindsight **runs on Atlassian** (Forge). It has no external servers and makes no calls to
  third-party services.
- Forecasts (risk, similar work, lessons, and the account references above) are cached in the
  app's Forge storage on Atlassian infrastructure, scoped to the installing site.
- Text analysis uses **Atlassian-hosted AI models** (Forge LLMs). Data is not used to train models
  and is not sent outside Atlassian.
- If a site admin connects Hindsight's Teamwork Graph connector, forecast summaries are written
  to that site's Teamwork Graph, governed by the site's own permissions.

## What Hindsight does not do

- It does not sell, share or transfer data to anyone.
- It does not track users or collect analytics beyond what the Atlassian platform provides.

## Retention and deletion

Cached forecasts stay in Forge storage until the app is uninstalled; uninstalling Hindsight
deletes its Forge storage. Teamwork Graph data from the connector is deleted when the connection
is removed. Sample data created by "Load sample history" can be removed with "Remove sample data".

## Contact

Questions or deletion requests: see the support contact on the app's installation page.
