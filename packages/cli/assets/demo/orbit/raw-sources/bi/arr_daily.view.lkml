view: arr_daily {
  sql_table_name: orbit_analytics.mart_arr_daily ;;
  description: "Contract-first ARR from dbt://ktx_demo.mart_arr_daily and notion://notion_page_arr_contract_reporting#arr-contract-first."

  dimension: arr_daily_key {
    primary_key: yes
    type: string
    sql: CONCAT('all_accounts-', ${TABLE}.metric_date) ;;
  }

  dimension: account_id {
    type: string
    sql: 'all_accounts' ;;
  }

  dimension_group: metric {
    type: time
    timeframes: [date, week, month, quarter]
    sql: ${TABLE}.metric_date ;;
  }

  measure: arr {
    type: sum
    sql: ${TABLE}.arr_cents ;;
    value_format_name: usd_0
    description: "Active contract ARR as of the requested metric date."
  }
}
