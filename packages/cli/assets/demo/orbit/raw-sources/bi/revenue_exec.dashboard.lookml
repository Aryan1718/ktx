# looker_dashboard_id: dash_revenue_exec
dashboard: revenue_exec {
  title: "Gross and Net Revenue Executive Dashboard"

  element: gross_revenue_tile {
    title: "Gross Revenue"
    explore: revenue
    fields: [revenue.revenue_month, revenue.gross_revenue]
  }

  element: credits_tile {
    title: "Credits"
    explore: revenue
    fields: [revenue.revenue_month, revenue.credits]
  }

  element: refunds_tile {
    title: "Refunds"
    explore: revenue
    fields: [revenue.revenue_month, revenue.refunds]
  }

  element: february_reconciliation_tile {
    title: "February Reconciliation"
    explore: revenue
    fields: [revenue.gross_revenue, revenue.credits, revenue.refunds, revenue.net_revenue]
  }
}
