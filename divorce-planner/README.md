# Colorado Divorce Planner

Private, browser-only planner for a Colorado dissolution of marriage. Three tabs:

- **Planner** – step-by-step checklist through the Colorado process with deadlines computed from your filing and service dates (21-day response, 42-day financial disclosure, 91-day earliest decree).
- **Worksheet** – inventory of assets and debts with marital/separate tagging and a proposed split, spouse incomes, Colorado advisory maintenance estimate (C.R.S. 14-10-114), and a post-divorce monthly budget.
- **Documents** – tracker for the records you need to gather, plus a printable summary to hand to a lawyer or mediator.

All data stays in your browser's localStorage. Use Export/Import to move it between devices. Nothing is sent to a server.

This is an organizational aid, not legal advice. Verify form numbers and rules at https://www.coloradojudicial.gov/self-help/divorce-family-matters.

## Deploy

```bash
cd divorce-planner
npx wrangler deploy
```
