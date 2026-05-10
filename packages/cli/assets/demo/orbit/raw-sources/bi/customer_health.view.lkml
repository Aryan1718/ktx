view: customer_health {
  sql_table_name: orbit_analytics.mart_customer_health ;;
  description: "Customer health mart dbt://ktx_demo.mart_customer_health governed by notion://notion_page_customer_health_playbook#risk-definition."

  dimension: customer_health_key {
    primary_key: yes
    type: string
    sql: CONCAT(${TABLE}.account_id, '-', ${TABLE}.as_of_date) ;;
  }

  dimension: account_id {
    type: string
    sql: ${TABLE}.account_id ;;
  }

  dimension_group: metric {
    type: time
    timeframes: [date, week, month]
    sql: ${TABLE}.as_of_date ;;
  }

  dimension: health_risk_tier {
    type: string
    sql: ${TABLE}.risk_level ;;
  }

  dimension: is_paying_customer {
    type: yesno
    sql: ${TABLE}.is_active_customer ;;
  }

  measure: active_customers {
    type: count_distinct
    sql: ${account_id} ;;
    filters: [is_paying_customer: "yes"]
    description: "Active paying customer accounts in the health mart."
  }

  measure: high_risk_accounts {
    type: count_distinct
    sql: ${account_id} ;;
    filters: [health_risk_tier: "high"]
    description: "High-risk paying accounts used by the customer_health_risk_accounts expected answer."
  }

  measure: open_support_tickets {
    type: sum
    sql: case when ${TABLE}.has_unresolved_high_ticket then 1 else 0 end ;;
  }
}
