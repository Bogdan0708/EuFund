# Cloud Armor policy for Cloud Run external HTTPS load balancer

locals {
  known_bad_ips_expression = length(var.cloud_armor_known_bad_ip_ranges) > 0 ? join(" || ", [
    for cidr in var.cloud_armor_known_bad_ip_ranges : "inIpRange(origin.ip, '${cidr}')"
  ]) : null
}

resource "google_compute_security_policy" "cloud_run" {
  name        = var.cloud_armor_policy_name
  description = "Cloud Armor policy for ${var.app_name} Cloud Run"

  # Block explicitly listed abusive IP ranges first.
  dynamic "rule" {
    for_each = local.known_bad_ips_expression == null ? [] : [1]
    content {
      priority = 900
      action   = "deny(403)"
      preview  = false

      match {
        expr {
          expression = local.known_bad_ips_expression
        }
      }

      description = "Block known bad IP ranges"
    }
  }

  # Optional geo blocking (configure with ISO country codes).
  dynamic "rule" {
    for_each = length(var.cloud_armor_geo_blocked_country_codes) == 0 ? [] : [1]
    content {
      priority = 950
      action   = "deny(403)"
      preview  = false

      match {
        expr {
          expression = "origin.region_code.matches('(${join("|", var.cloud_armor_geo_blocked_country_codes)})')"
        }
      }

      description = "Block configured geographies"
    }
  }

  # API rate limiting: 100 requests/minute per source IP (API routes only).
  rule {
    priority = 1000
    action   = "throttle"
    preview  = false

    match {
      expr {
        expression = "request.path.matches('/api/.*')"
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = 100
        interval_sec = 60
      }
    }

    description = "Throttle API routes to 100 requests/minute per IP"
  }

  # Frontend rate limiting: 2000 requests/minute per source IP (static/pages).
  rule {
    priority = 1050
    action   = "throttle"
    preview  = false

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }

    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"

      rate_limit_threshold {
        count        = 2000
        interval_sec = 60
      }
    }

    description = "Throttle frontend to 2000 requests/minute per IP"
  }

  # OWASP SQL injection protections.
  rule {
    priority = 1100
    action   = "deny(403)"
    preview  = false

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('sqli-v33-stable')"
      }
    }

    description = "Block SQL injection attacks"
  }

  # OWASP XSS protections.
  rule {
    priority = 1200
    action   = "deny(403)"
    preview  = false

    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable')"
      }
    }

    description = "Block XSS attacks"
  }

  # Default allow if no prior rule matches.
  rule {
    priority = 2147483647
    action   = "allow"

    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }

    description = "Default allow"
  }
}
