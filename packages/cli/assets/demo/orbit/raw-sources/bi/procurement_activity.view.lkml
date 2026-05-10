view: procurement_activity {
  sql_table_name: orbit_analytics.mart_procurement_activity ;;
  description: "Procurement activity mart dbt://ktx_demo.mart_procurement_activity with governed context notion://notion_page_procurement_instrumentation#qualifying-procurement-actions."

  dimension: procurement_activity_key {
    primary_key: yes
    type: string
    sql: CONCAT(${TABLE}.contract_arr_threshold_cents, '-', ${TABLE}.week_start_date) ;;
  }

  dimension: account_id {
    type: string
    sql: 'all_accounts' ;;
  }

  dimension_group: week_start {
    type: time
    timeframes: [date, week]
    sql: ${TABLE}.week_start_date ;;
  }

  dimension: contract_arr_band {
    type: string
    sql: case
      when ${TABLE}.contract_arr_threshold_cents >= 20000000 then 'over_200k'
      else 'under_200k'
    end ;;
    description: "Contract ARR band represented by the procurement activity threshold."
  }

  measure: weekly_active_requesters {
    type: sum
    sql: ${TABLE}.active_requesters ;;
    description: "Distinct non-internal requesters with qualifying procurement workflow actions during the requested week."
  }

  measure: purchase_requests {
    type: sum
    sql: 0 ;;
  }

  measure: approval_actions {
    type: sum
    sql: 0 ;;
  }
}
