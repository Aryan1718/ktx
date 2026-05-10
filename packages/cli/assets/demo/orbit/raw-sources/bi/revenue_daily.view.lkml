view: revenue_daily {
  sql_table_name: orbit_analytics.mart_revenue_daily ;;
  description: "Revenue recognition mart dbt://ktx_demo.mart_revenue_daily governed by notion://notion_page_revenue_reporting_policy#gross-to-net-reconciliation."

  dimension: revenue_daily_key {
    primary_key: yes
    type: string
    sql: CONCAT('all_accounts-', ${TABLE}.revenue_date) ;;
  }

  dimension: account_id {
    type: string
    sql: 'all_accounts' ;;
  }

  dimension_group: revenue {
    type: time
    timeframes: [date, week, quarter]
    sql: ${TABLE}.revenue_date ;;
  }

  dimension: revenue_month {
    type: string
    sql: TO_CHAR(${TABLE}.revenue_date, 'YYYY-MM') ;;
  }

  measure: gross_revenue {
    type: sum
    sql: ${TABLE}.gross_revenue_cents ;;
    value_format_name: usd_0
    description: "Paid invoice line revenue before credits and refunds."
  }

  measure: credits {
    type: sum
    sql: ${TABLE}.credits_cents ;;
    value_format_name: usd_0
  }

  measure: refunds {
    type: sum
    sql: ${TABLE}.refunds_cents ;;
    value_format_name: usd_0
  }

  measure: net_revenue {
    type: sum
    sql: ${TABLE}.net_revenue_cents ;;
    value_format_name: usd_0
    description: "Gross revenue minus credits and successful refunds, recognized by paid/refund dates."
  }
}
