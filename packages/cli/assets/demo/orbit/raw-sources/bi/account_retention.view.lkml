view: account_retention {
  sql_table_name: orbit_analytics.mart_nrr_quarterly ;;
  description: "Canonical dbt mart dbt://ktx_demo.mart_nrr_quarterly with governed policy notion://notion_page_retention_policy_current#nrr-definition."

  dimension: retention_key {
    primary_key: yes
    type: string
    sql: CONCAT(${TABLE}.segment, '-', ${TABLE}.quarter_label) ;;
  }

  dimension: account_id {
    type: string
    sql: ${TABLE}.segment ;;
  }

  dimension: parent_account_id {
    type: string
    sql: ${TABLE}.segment ;;
  }

  dimension: fiscal_quarter {
    type: string
    sql: ${TABLE}.quarter_label ;;
  }

  dimension: segment {
    type: string
    sql: ${TABLE}.segment ;;
  }

  dimension: net_revenue_retention {
    type: number
    sql: ${TABLE}.net_revenue_retention ;;
  }

  measure: nrr {
    type: average
    sql: ${net_revenue_retention} ;;
    value_format_name: percent_1
    description: "Enterprise parent-account NRR from dbt://ktx_demo.mart_nrr_quarterly and notion://notion_page_retention_policy_current#nrr-definition."
  }

  measure: starting_arr {
    type: sum
    sql: ${TABLE}.starting_arr_cents ;;
    value_format_name: usd_0
  }

  measure: expansion_arr {
    type: sum
    sql: ${TABLE}.expansion_arr_cents ;;
    value_format_name: usd_0
    description: "Expansion ARR used by the enterprise_expansions_q1_2026 expected answer."
  }

  measure: contraction_arr {
    type: sum
    sql: ${TABLE}.contraction_arr_cents ;;
    value_format_name: usd_0
  }

  measure: churned_arr {
    type: sum
    sql: ${TABLE}.churned_arr_cents ;;
    value_format_name: usd_0
  }
}
