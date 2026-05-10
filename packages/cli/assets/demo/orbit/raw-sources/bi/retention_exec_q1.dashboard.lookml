# looker_dashboard_id: dash_retention_exec_q1
dashboard: retention_exec_q1 {
  title: "Enterprise Retention Executive Review"

  element: retention_tile {
    title: "Enterprise NRR"
    explore: retention
    fields: [retention.fiscal_quarter, retention.nrr]
  }

  element: movement_breakout_tile {
    title: "Movement Breakout"
    explore: retention
    fields: [retention.expansion_arr, retention.contraction_arr, retention.churned_arr]
  }

  element: discount_expiration_contraction_tile {
    title: "Discount Expiration Contraction"
    explore: retention
    fields: [retention.parent_account_id, retention.contraction_arr]
  }

  element: q4_vs_q1_comparison_tile {
    title: "Q4 vs Q1 Comparison"
    explore: retention
    fields: [retention.fiscal_quarter, retention.nrr]
  }
}
